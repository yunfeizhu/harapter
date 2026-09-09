# Harapter

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

`harapter` 是连接不同 Harness Runtime 的默认应用入口，对外提供统一的 Client /
Session / Run
API。应用配置 Runtime 连接后，可以复用任务提交、事件外层结构和最终结果处理代码。

`harapter`
是唯一对外发布的包。Core、Adapter、Transport 和 Conformance 作为私有源码模块打包到其中。单包入口的首次 npm 发布尚待完成；下面的安装命令适用于该版本发布后。

## 在应用中安装

使用 Node.js 24+ 和 ESM，只安装一个 Harapter 包：

```sh
npm install harapter
npm install -D typescript @types/node
npm pkg set type=module
```

包内包含 Core 和受维护的第一方协议映射，唯一的运行时依赖是小型 `ws`
传输库。按选择动态加载实现，不会安装上游 Harness
SDK 或 Runtime。Tarball 包含全部映射代码；选择控制加载范围，不改变下载大小。只有使用
`harapter/conformance` 时才需要单独安装 Vitest；`harapter/testing`
不需要 Vitest。

## 配置 DSH 或 OpenCode，复用同一段应用代码

将下面的完整入口保存为 `app.ts`。`runTask` 是共用的业务操作，Runtime 差异只在
`selectedProfile` 和宿主鉴权配置中。接入服务时，从该文件导入
`runTask`，由请求处理器调用，并将 `result.finalMessage` 返回给有权限的 UI。

<!-- sdk-example: quick-unified.ts -->

```ts
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createHarapter,
  providerId,
  profileId,
  HarnessError,
  isHarnessError,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRegistry,
  type HarnessSession,
  type CreateSessionInput,
} from 'harapter';

/** The same business function runs on every configured harness. */
export async function runTask(
  harapter: HarnessRegistry,
  profile: HarnessProfile,
  text: string,
  onEvent: (event: HarnessEvent) => void,
  sessionOptions: CreateSessionInput = {},
) {
  const client = await harapter.connect(profile);
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession(sessionOptions);
    const run = await session.start(
      { parts: [{ type: 'text', text }] },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      onEvent(event);
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'This text example requires a non-interactive Runtime configuration.',
          { retryable: false },
        );
    }
    return { result: await run.result(), sessionRef: session.ref() };
  } finally {
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

/** Only connection configuration differs; Runtime preparation belongs to the host. */
function selectedProfile(): HarnessProfile {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const profiles = {
    dsh: (): HarnessProfile => ({
      profileId: profileId('local-dsh'),
      providerId: providerId('deepseek.harness'),
      displayName: 'Local DSH',
      connection: {
        kind: 'process',
        ownership: 'adapter',
        cwd: workspace,
        command: required('HARAPTER_DSH_COMMAND'),
        args: [
          '--profile',
          'sdk-minimal',
          '--patch',
          required('HARAPTER_DSH_PATCH'),
        ],
      },
      providerOptions: {
        provider: required('HARAPTER_DSH_PROVIDER'),
        model: required('HARAPTER_DSH_MODEL'),
      },
    }),
    opencode: (): HarnessProfile => ({
      profileId: profileId('local-opencode'),
      providerId: providerId('opencode'),
      displayName: 'Local OpenCode',
      connection: {
        kind: 'endpoint',
        ownership: 'external',
        transport: 'http',
        url: required('HARAPTER_OPENCODE_URL'),
        authRef: { scheme: 'env', id: 'opencode' },
      },
    }),
  };
  const name = required('HARAPTER_HARNESS');
  if (name !== 'dsh' && name !== 'opencode')
    throw new Error('Select dsh or opencode.');
  return profiles[name]();
}

async function main() {
  const harapter = await createHarapter({
    harnesses: ['dsh', 'opencode'],
    resolveAuthHeaders: (ref) => {
      if (ref.scheme !== 'env' || ref.id !== 'opencode')
        throw new Error('Unknown authentication reference.');
      return {
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      };
    },
  });
  const { result } = await runTask(
    harapter,
    selectedProfile(),
    'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
    (event) => {
      console.log({ type: event.type, sequence: event.sequence });
    },
    { workspace: { uri: pathToFileURL(required('HARAPTER_WORKSPACE')).href } },
  );
  // Return result.finalMessage to an authorized application UI; log metadata only.
  console.log({
    status: result.status,
    hasText: result.finalMessage !== undefined,
  });
  if (result.status !== 'completed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: isHarnessError(error) ? error.code : 'application_failed',
      }),
    );
    process.exitCode = 1;
  });
}
```

## 准备选中的 Runtime

使用空的测试 Workspace。按照 [DSH 指南](../../providers/dsh/README.zh-CN.md)
准备官方 CLI、`sdk-minimal` Profile、模型凭据以及禁用工具的 Patch。设置
`HARAPTER_HARNESS=dsh`、`HARAPTER_WORKSPACE`、`HARAPTER_DSH_COMMAND`、
`HARAPTER_DSH_PATCH`、`HARAPTER_DSH_PROVIDER` 和 `HARAPTER_DSH_MODEL`。

也可以按照 [OpenCode 指南](../../providers/opencode/README.zh-CN.md)
准备已鉴权且禁用工具的服务。设置 `HARAPTER_HARNESS=opencode`、
`HARAPTER_WORKSPACE`（服务端的绝对目录）、`HARAPTER_OPENCODE_URL`、
`OPENCODE_SERVER_PASSWORD`，以及可选的 `OPENCODE_SERVER_USERNAME`（默认
`opencode`）。仅选中的 Profile 会读取对应配置。不要把密钥放进 Profile 或打印出来。

运行 `node app.ts`。预期先输出事件类型，再输出
`{ status: "completed", hasText: true }`。调用可能产生模型费用。60 秒 Run 截止时间不代表原生取消。示例遇到需要宿主 UI 的交互会明确失败，并在退出时关闭 Client 和 Session；外部 OpenCode 服务继续运行。

## 公共 API 与配置

- `createHarapter(options?)` 返回
  `Promise<HarnessRegistry>`。在应用组装时等待一次，然后通过 `connect(profile)`
  连接选中的 Runtime。创建 Registry 不启动进程或连接。
- `HarapterOptions.harnesses`
  显式选择内置实现；重复项只加载一次。省略整个参数会返回空的可扩展 Registry；传入配置对象时必须提供
  `harnesses` 数组。
- `resolveAuthHeaders(ref)` 为 OpenCode 和 Hermes 提供宿主持有的 HTTP 请求头；
  `resolveGatewayCookie(ref, signal)` 提供 DSH Gateway
  Cookie。仅在对应 Adapter 需要鉴权时调用。宿主根据准确的 Secret 引用判断权限。
- 重新导出所有
  [Core 公共接口](../core/README.zh-CN.md)，包括 Profile、输入、事件、最终结果、能力、错误和扩展。入口不导出 Adapter 命名空间或第三方 Runtime
  API。

| 选择名称   | Profile `providerId` | Runtime 连接与兼容范围说明                                         |
| ---------- | -------------------- | ------------------------------------------------------------------ |
| `codex`    | `openai.codex`       | [Codex app-server](../../providers/codex/README.zh-CN.md)          |
| `dsh`      | `deepseek.harness`   | [DSH SDK 进程或 Gateway 端点](../../providers/dsh/README.zh-CN.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP 服务](../../providers/hermes/README.zh-CN.md)         |
| `openclaw` | `openclaw`           | [OpenClaw ACP 进程](../../providers/openclaw/README.zh-CN.md)      |
| `opencode` | `opencode`           | [OpenCode HTTP 服务](../../providers/opencode/README.zh-CN.md)     |
| `pi`       | `pi.agent`           | [Pi JSONL 进程](../../providers/pi/README.zh-CN.md)                |

Profile 通过 `connection`、`providerOptions` 和可选 `requiredCapabilities`
选择已有机器接口，不会从任意 Runtime 对象自动推断协议。每个内置实现仍以其文档中的兼容范围和能力证据为准。

## 生命周期、错误与原生接入

返回的 Registry 就是现有 Core
Registry：隔离 Profile 快照，校验连接类型和能力要求，并把 Session 绑定到创建它的 Provider、Profile 和原生状态。切换 Harness 后创建新 Session。注册不会让检查点可迁移，也不会新增原生分叉、取消能力或替换 Runtime 的工具与权限策略。

持续消费 `run.events()`，以 `run.result()`
为最终状态依据。事件类型和外层结构统一， `event.data`
仍遵循对应 Adapter 的映射；不能假定所有 Payload 都是同一种文本增量或工具结构。超出公共生命周期的操作由能力声明和类型化扩展描述。私有内容和 Session 引用由宿主授权存储保管，不进入通用日志。

非法 Harness 选择返回 `invalid_request`；内置实现无法初始化返回脱敏后的
`provider_api_incompatible`。修复配置或安装前，两者均不应直接重试。未注册的 Profile 返回
`provider_not_found`；连接、鉴权、生命周期错误沿用 Core 分类。

自定义 Adapter 使用 `registry.register(factory)`
注册。OpenClaw 宿主 Gateway 绑定等原生组装需求，从 `harapter/openclaw`
显式导入 Factory，而不选择默认内置项。这些都是同一个 SDK 的子路径，Core 和原生扩展契约保持一致。

## 验证与包链接

[Runtime Profile 示例](../../examples/runtime-profiles/README.zh-CN.md)
通过 DSH 进程和带鉴权的 OpenCode HTTP
Fixture 验证共同任务代码、终态事件、Session 归属和清理行为。发布检查在隔离项目中只安装
`harapter`
Tarball，编译示例并运行两个 Fixture，确认没有安装任何独立 Adapter 包。这是确定性集成证据，不是新的真实 Runtime 验证。

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](../../providers/dsh/README.zh-CN.md) ·
[OpenCode](../../providers/opencode/README.zh-CN.md)

## 公开子路径

以下入口都属于同一个已安装的包。普通应用使用根入口；原生能力接入、自定义 Adapter 和测试可以使用明确的子路径。

| Import                              | Guide                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `harapter`                          | [core](../../packages/core/README.zh-CN.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](../../packages/transport-jsonrpc-stdio/README.zh-CN.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](../../packages/transport-jsonl-process/README.zh-CN.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](../../packages/transport-http-sse/README.zh-CN.md)           |
| `harapter/transports/acp`           | [transport-acp](../../packages/transport-acp/README.zh-CN.md)                     |
| `harapter/conformance`              | [conformance](../../packages/conformance/README.zh-CN.md)                         |
| `harapter/codex`                    | [adapter-codex](../../providers/codex/README.zh-CN.md)                            |
| `harapter/dsh`                      | [adapter-dsh](../../providers/dsh/README.zh-CN.md)                                |
| `harapter/hermes`                   | [adapter-hermes](../../providers/hermes/README.zh-CN.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](../../providers/openclaw/README.zh-CN.md)                      |
| `harapter/opencode`                 | [adapter-opencode](../../providers/opencode/README.zh-CN.md)                      |
| `harapter/pi`                       | [adapter-pi](../../providers/pi/README.zh-CN.md)                                  |
| `harapter/testing`                  | [Fake Provider](../conformance/README.zh-CN.md)                                   |

## 从独立包迁移

将 `@harapter/*` 依赖替换为 `harapter`。Core 类型从 `harapter`
导入，原生 Factory 和扩展从对应 Harness 子路径导入，Transport 使用
`harapter/transports/*`，Fake Provider 使用 `harapter/testing`，一致性测试使用
`harapter/conformance`。同步更新应用中的导入；旧包名不作为兼容别名保留。Session 归属和原生兼容条件仍然适用。旧 npm 包的删除是已单独授权的注册表操作，待替代入口可用后执行。
