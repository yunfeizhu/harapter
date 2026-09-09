<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="./docs/assets/harapter-banner.png" alt="Harapter 将一个可移植核心连接到多种 Agent Harness Runtime" width="1200">
</p>

<h1 align="center">Harapter</h1>

<p align="center">
  <strong>为需要接入多个 Agent Harness 的应用提供一套与 Provider 无关的统一 TypeScript API。</strong><br>
  宿主使用同一套 Client、Session、Run、流式 Event、Capability 和 Error 生命周期编排不同 Runtime；各 Adapter 仍保留 Provider 的状态所有权、已观测 Capability 与原生 Extension。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./docs/design/README.zh-CN.md">设计</a> ·
  <a href="./examples/README.md">示例</a> ·
  <a href="./CONTRIBUTING.md">贡献</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/releases"><img src="https://img.shields.io/github/v/release/yunfeizhu/harapter?display_name=tag&amp;include_prereleases&amp;sort=semver&amp;style=flat-square&amp;label=release" alt="GitHub Release"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

Harapter 是一个面向多 Agent
Harness 应用的开源适配层。宿主使用一套 TypeScript 契约处理 Client、Session、Run、流式 Event、Interaction、Capability 和 Error；独立的 Provider
Adapter 将这些契约转换到官方 SDK 和机器协议。

它位于应用与所选 Runtime 之间，是基础设施，而不是新的 Agent
Loop。每个 Runtime 仍由宿主选择、安装、认证并实施安全策略。

## npm 包导航

只安装
[`harapter`](https://www.npmjs.com/package/harapter)。下表是同一个 SDK 的模块，不是独立 npm 包。单包入口的首次发布尚待完成。

| API                                 | 使用指南                                                       |
| ----------------------------------- | -------------------------------------------------------------- |
| `harapter`                          | [使用指南](./packages/harapter/README.zh-CN.md)                |
| `harapter/transports/jsonrpc-stdio` | [使用指南](./packages/transport-jsonrpc-stdio/README.zh-CN.md) |
| `harapter/transports/jsonl-process` | [使用指南](./packages/transport-jsonl-process/README.zh-CN.md) |
| `harapter/transports/http-sse`      | [使用指南](./packages/transport-http-sse/README.zh-CN.md)      |
| `harapter/transports/acp`           | [使用指南](./packages/transport-acp/README.zh-CN.md)           |
| `harapter/conformance`              | [使用指南](./packages/conformance/README.zh-CN.md)             |
| `harapter/codex`                    | [使用指南](./providers/codex/README.zh-CN.md)                  |
| `harapter/dsh`                      | [使用指南](./providers/dsh/README.zh-CN.md)                    |
| `harapter/hermes`                   | [使用指南](./providers/hermes/README.zh-CN.md)                 |
| `harapter/openclaw`                 | [使用指南](./providers/openclaw/README.zh-CN.md)               |
| `harapter/opencode`                 | [使用指南](./providers/opencode/README.zh-CN.md)               |
| `harapter/pi`                       | [使用指南](./providers/pi/README.zh-CN.md)                     |

## 快速上手

在自己的 Node.js 24+ 应用中使用默认入口
`harapter`，配置 Runtime 连接后复用同一段任务代码。该入口的首次 npm 发布尚未完成，下面的命令用于首次发布后；Core、Adapter、Transport 和 Conformance 仅作为内部模块维护。

### 1. 只安装一个 Harapter 包

```sh
mkdir my-harapter-app
cd my-harapter-app
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

Harapter 内部包含协议映射，按选择加载实现，不会安装 DSH、Pi、Codex 等 Runtime。应用只需准备自己使用的 Runtime。单个 Tarball 包含全部受维护的映射代码，选择较少 Harness 不会缩小下载包。高级组装从同一个 SDK 的
`harapter/dsh` 等子路径导入。

### 2. 配置需要使用的 Runtime

按照 [DSH 指南](./providers/dsh/README.zh-CN.md) 准备官方 CLI、模型凭据、
`sdk-minimal` Profile 和禁用工具的 Patch。设置 `HARAPTER_HARNESS=dsh`、
`HARAPTER_WORKSPACE`、`HARAPTER_DSH_COMMAND`、`HARAPTER_DSH_PATCH`、
`HARAPTER_DSH_PROVIDER` 和 `HARAPTER_DSH_MODEL`。

使用 [OpenCode](./providers/opencode/README.zh-CN.md)
时，准备已鉴权、禁用工具的服务，设置
`HARAPTER_HARNESS=opencode`、`HARAPTER_WORKSPACE`（服务端绝对目录）、
`HARAPTER_OPENCODE_URL`、`OPENCODE_SERVER_PASSWORD`，以及可选的
`OPENCODE_SERVER_USERNAME`（默认
`opencode`）。只需要填写选中 Profile 的环境配置。请使用空的测试 Workspace，模型调用可能产生费用。

### 3. 用同一段应用代码运行任务

保存为 `app.ts`。两个连接配置都调用同一个 `runTask`，业务代码只导入 `harapter`。

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

运行 `node app.ts`。预期先输出事件类型，再输出
`{ status: "completed", hasText: true }`。`result.finalMessage`
是可返回授权 UI 的最终文本，失败的 Run 仍然是失败。示例持续消费事件、设置 60 秒截止时间，并关闭自己持有的资源；外部服务继续运行。该示例要求 Runtime 使用无需交互的安全策略。

### 4. 接入真实项目

在请求处理器中导入这里的
`runTask`。将连接和密钥解析放在应用组装层，每个任务选择Profile，复用任务与结果处理。[入口指南](./packages/harapter/README.zh-CN.md)
说明配置、能力边界和错误；[Runtime Profile 示例](./examples/runtime-profiles/README.zh-CN.md)
提供可执行源文件。[服务示例](./examples/sdk-application/README.zh-CN.md)
继续覆盖宿主存储、重连、取消和审批 UI。

Session 仍绑定原来的 Provider、Profile 和原生状态，切换 Runtime 后需要创建新 Session。事件外层结构统一，`event.data`
仍遵循 Adapter 映射。不能根据 Harness 名称推断原生取消或分叉能力，也不要记录私有内容、凭据或 Session 状态。

## 为什么选择 Harapter

| 原则                    | 对宿主应用的含义                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------- |
| **一套生命周期**        | 编写一次编排流程，再为每个任务选择 Harness Profile。                                  |
| **状态有明确的所有者**  | Session 始终绑定创建它的 Provider、连接 Profile 和原生状态。                          |
| **Capability 来自观测** | `native`、`emulated`、`adapter_controlled`、`unsupported` 和 `unknown` 保持明确区分。 |
| **如实表达终态**        | 进程或连接中止不会伪装成 Provider 原生 Run 取消或成功完成。                           |
| **原生能力仍然可达**    | 类型化 Extension 和显式 Native Escape Hatch 保留无法移植但仍有价值的行为。            |
| **未知事件仍然可观测**  | 有界、脱敏的 Provider Channel 保留上游变化，不把未知事件猜测为可移植的成功事件。      |

## 架构

<!-- markdownlint-disable MD033 -->

<p align="center">
  <img src="./docs/assets/harapter-architecture.zh-CN.svg" alt="Harapter 可移植生命周期与 Provider Adapter 架构" width="1200">
</p>

<!-- markdownlint-enable MD033 -->

Core 不导入 Provider
SDK，不根据 Provider 名称分支，也不根据 Provider 身份推断 Capability。协议映射、兼容检查、有界 Transport 行为和脱敏 Fixture 由各 Adapter 负责。

### 可移植边界

| Harapter 统一处理                                               | Provider 或宿主继续负责                                   |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Profile 选择与 Adapter 动态注册                                 | Runtime 安装、更新、认证和许可证                          |
| Client、Session、Run、有序 Event Stream 和权威 Terminal Result  | Agent Loop、Prompt、Model、Tool、Plugin、Skill 和原生配置 |
| Capability Mode、可移植 Error、Interaction 和生命周期所有权检查 | 原生 Checkpoint、Provider 存储和服务可用性                |
| 类型化 Provider Extension 和显式 Native Escape Hatch            | 宿主任务存储、凭据解析和宿主应用的安全策略                |

## 已实现模块

| 范围                 | Package 与模块                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable API**     | [`harapter`](./packages/core/README.zh-CN.md)——契约、Registry、Capability Requirement、所有权检查、Error、Extension 和 Native Access                                                                                                                                                                  |
| **Conformance**      | [`harapter/conformance`](./packages/conformance/README.zh-CN.md)——可复用的可移植行为套件和确定性 Fake Provider                                                                                                                                                                                        |
| **Transport**        | [JSON-RPC stdio](./packages/transport-jsonrpc-stdio/README.zh-CN.md)、[严格 JSONL process RPC](./packages/transport-jsonl-process/README.zh-CN.md)、[HTTP/SSE](./packages/transport-http-sse/README.zh-CN.md) 和 [ACP v1](./packages/transport-acp/README.zh-CN.md)                                   |
| **Provider Adapter** | [Codex](./providers/codex/README.zh-CN.md)、[OpenCode](./providers/opencode/README.zh-CN.md)、[DeepSeek Harness](./providers/dsh/README.zh-CN.md)、[Hermes Agent](./providers/hermes/README.zh-CN.md)、[OpenClaw](./providers/openclaw/README.zh-CN.md) 和 [Pi Agent](./providers/pi/README.zh-CN.md) |
| **参考实现**         | [单 Provider 生命周期](./examples/single-provider/README.md)与[并发多 Provider Client](./examples/multi-provider-client/README.md)                                                                                                                                                                    |

## 先有证据，再声明支持

矩阵里的一行并不代表已经支持。Adapter 必须具备实现、脱敏 Fixture、协议 Mapping 与生命周期测试、Provider-negative 测试、公共 Conformance、明确的兼容边界和真实 Runtime 证据，Harapter 才会把该接口描述为源码级支持。

| Provider                                            | 官方接口                | 当前证据状态                                                              |
| --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| [Codex](./providers/codex/README.zh-CN.md)          | 稳定 App Server         | **源码级支持**——具备 Fixture、Conformance、兼容与真实运行证据             |
| [OpenCode](./providers/opencode/README.zh-CN.md)    | 稳定 HTTP/OpenAPI + SSE | **源码级支持**——具备 Fixture、Conformance、兼容与真实运行证据             |
| [DeepSeek Harness](./providers/dsh/README.zh-CN.md) | SDK Runtime JSON-RPC    | **源码级实验**——已有真实运行证据，但 Runtime 不协商兼容版本               |
| [Hermes Agent](./providers/hermes/README.zh-CN.md)  | API Server HTTP/SSE     | **源码级实验**——已使用 0.21.0 完成真实运行验证，但 Runtime 不协商兼容版本 |
| [OpenClaw](./providers/openclaw/README.zh-CN.md)    | ACP v1 Bridge           | **源码级支持**——具备 Fixture、Conformance、兼容性与真实文本 Run 证据      |
| [Pi Agent](./providers/pi/README.zh-CN.md)          | 严格 JSONL RPC 模式     | **源码级实验**——已使用 0.84.4 完成真实运行验证，但 Runtime 不协商兼容版本 |

“源码级支持”描述源码 Adapter 所持有的证据，不是已发布 Package 的保证。“源码级实验”表示 Adapter 已经实现，并按声明的接口完成确定性测试，但仍缺所需的真实 Runtime 证据，或当前连接的 Runtime 无法与已验证证据安全匹配。

Harapter 的库不会在宿主应用中安装 Provider Runtime；可信 Live
Canary 仅在临时 GitHub Runner 中安装选定的当前 Runtime，以持续收集验证证据。

准确的 Capability 和兼容边界请查看
[Provider 接入矩阵](./docs/design/provider-matrix.zh-CN.md)与各 Provider
README。

## 更多示例

面向应用接入的案例从[独立 SDK 应用](./examples/sdk-application/README.zh-CN.md)开始。

- [单 Provider 参考实现](./examples/single-provider/README.md)展示完整的 Client
  → Session → Run → Event → Result 生命周期及安全清理。
- [多 Provider 参考实现](./examples/multi-provider-client/README.md)展示 Profile 路由、并发事件流、Session 级控制项、所有权验证和显式 Provider
  Extension 边界。

两份参考实现默认都保持确定性：测试不会发现、安装、认证或调用第三方 Runtime。只有宿主显式提供 Runtime 配置时，可选的 Live 入口才会运行。

### 运行仓库参考程序（贡献者，可选）

只有开发 Harapter 或维护参考程序时才需要克隆完整仓库。Workspace 固定使用 pnpm
11.23.0：

```sh
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## 项目状态

npm 只发布 `harapter`，使用 `latest`
标签。Core、Adapter、Transport、Conformance、Workspace 根目录和示例均为私有模块。Release
Please 管理公开包版本，Tarball 检查、Provenance 和回滚控制仍然适用。单包入口的首次发布尚待完成；Harapter 不发布 PyPI 包或独立 CLI。

当前稳定化工作聚焦于消费者反馈、由宿主运行的实验 Adapter Live
Evidence 和发布准备。Portable Wire Schema、非 TypeScript SDK 和 Local-socket
Transport 会在出现真实消费者需求时实现。Goose、Qwen Code、Crush、GitHub Copilot
CLI 和 Cursor Agent CLI 不在当前实现范围内。

## 文档导航

| 从这里开始                                                         | 适合了解                                   |
| ------------------------------------------------------------------ | ------------------------------------------ |
| [架构与目标设计](./docs/design/README.zh-CN.md)                    | 系统边界、不变量、契约和设计顺序           |
| [Portable Core 契约](./packages/core/README.zh-CN.md)              | 公共 TypeScript API 与所有权语义           |
| [Provider 接入矩阵](./docs/design/provider-matrix.zh-CN.md)        | 各 Provider 的接口、证据与 Capability 状态 |
| [Provider 实现指南](./docs/design/provider-adapter-guide.zh-CN.md) | 在不削弱可移植事实的前提下构建 Adapter     |
| [开发流程](./docs/development.md)                                  | 工具链、分支、验证、Review 与 Pull Request |
| [贡献指南](./CONTRIBUTING.md)                                      | 贡献要求与仓库流程                         |
| [安全策略](./SECURITY.md)                                          | 漏洞报告与受支持的安全边界                 |
| [发布策略](./RELEASING.md)                                         | Release Please、版本与发布准备             |

## 常见问题

### Harapter 会安装或管理 Agent Runtime 吗？

不会。Runtime 的选择、安装、认证、凭据、许可证和安全策略仍由宿主负责。

### Session 可以切换 Provider 或连接 Profile 吗？

不可以。Session 始终绑定创建它的 Provider、Profile 和不透明原生状态。迁移任务需要创建新的 Session；Harapter 不暗示 Checkpoint 可移植。

### 断开进程连接等于取消 Run 吗？

除非 Provider 能证明原生取消，否则不等于。Transport
Abort 与 Provider 确认的 Cancellation 是不同的生命周期结果。

### 实验 Adapter 只是占位实现吗？

不是。它们具备实现、有界且脱敏的 Fixture、Mapping 与生命周期测试、Provider-negative 覆盖、公共 Conformance 和明确兼容边界。实验标签记录的是仍有真实运行证据或 Runtime 兼容探测边界未解决，而不是缺少确定性实现证据。

### Package 如何进行版本管理和发布？

Release Please 管理单个 `harapter` 包的版本，并创建包含已验证 Tarball、SPDX
SBOM 和 SHA-256 校验文件的不可变 GitHub
Release。另一个经过单独授权的 Workflow 将同一个 Tarball 携带 Provenance 发布到 npm 的
`latest`。内部模块没有独立发布流程。

## 明确不做什么

Harapter 不实现 Agent Loop，不安装或更新 Provider
Runtime，不在 Harness 之间转换原生 Checkpoint，不接管宿主任务存储，不管理 Provider
Plugin Marketplace，不解析凭据，也不会静默修改宿主应用的安全策略。

## 许可证

项目使用 [Apache License 2.0](./LICENSE)。
