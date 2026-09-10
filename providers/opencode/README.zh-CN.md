<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/opencode</code></h1>

<p align="center"><strong>把宿主运行的 OpenCode HTTP/SSE Server 接入 Harapter。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

本指南描述单个 `harapter`
SDK 内的模块。普通应用接入请先看[应用指南](../../packages/harapter/README.zh-CN.md)。安装
`harapter` 即可，无需为此模块另装 npm 包。

`harapter/opencode` 将当前稳定的 `opencode serve`
HTTP/OpenAPI 与 SSE 接口映射为 Harapter 生命周期。宿主负责安装、认证、启动和停止 Server；Adapter 只连接指定 Endpoint，不会隐式删除远端 Session。

## 在自己的应用中快速接入

使用 Node.js 24+ ESM 项目，把下面的完整示例保存为
`app.ts`，不需要 Harapter 仓库或私有导入。

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

### 宿主需要提供的配置

| 环境变量                   | 配置值                                              |
| -------------------------- | --------------------------------------------------- |
| `HARAPTER_OPENCODE_URL`    | 已经运行的 OpenCode HTTP 服务地址。                 |
| `OPENCODE_SERVER_USERNAME` | 服务 Basic-auth 用户名；示例默认 opencode。         |
| `OPENCODE_SERVER_PASSWORD` | 来自宿主凭证存储的服务 Basic-auth 密码。            |
| `HARAPTER_WORKSPACE`       | 已有空测试目录的绝对路径；OpenCode 使用服务端目录。 |

凭证只保留在 Runtime 或宿主环境中，不写入代码或 Session 引用。首次调用使用空测试工作区及经过宿主确认的禁用工具／只读配置。

按下表提供配置后执行 `node app.ts`。程序持续消费事件，最终文本位于
`result.finalMessage`，并始终清理资源。stdout 只输出元数据，内容应交给受控业务响应。模型调用可能消耗 token 并创建原生 Session 数据。

<!-- sdk-example: quick-opencode.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from 'harapter/opencode';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenCodeProviderFactory({
    resolveAuthHeaders: () =>
      Promise.resolve({
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      }),
  });
  const client = await factory.connect({
    profileId: profileId('my-opencode'),
    providerId: OPENCODE_PROVIDER_ID,
    displayName: 'Application opencode',
    connection: {
      kind: 'endpoint',
      url: required('HARAPTER_OPENCODE_URL'),
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'env', id: 'opencode' },
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
    });
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
          },
        ],
      },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new Error('Configure an explicit host interaction handler.');
      console.log({ type: event.type, sequence: event.sequence });
    }
    const result = await run.result();
    // Use result.finalMessage in your authorized application UI or response.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/package/harapter)

## 安装

```bash
pnpm add harapter
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from 'harapter';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from 'harapter/opencode';

const registry = new HarnessRegistry();
registry.register(createOpenCodeProviderFactory());

const client = await registry.connect({
  profileId: profileId('opencode-local'),
  providerId: OPENCODE_PROVIDER_ID,
  displayName: 'OpenCode',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:4096/',
    transport: 'http',
    ownership: 'external',
  },
});

const session = await client.createSession();
try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'Describe the current project.' }],
  });
  for await (const event of run.events()) console.log(event.type);
  console.log((await run.result()).status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

需要认证时，在 Connection 中放 `authRef`，并通过 Factory 的 `resolveAuthHeaders`
由宿主解析。Harapter 不记录、持久化或返回 Header 值。

## Session、Run 与输入

- Session 与目录绑定；File Workspace URI 会成为 OpenCode Directory；
- `session.close()` 只释放本地 Handle，不调用删除远端数据的 DELETE Route；
- 文本、带绝对 URI 和 `mediaType` 的 File/Image Reference 可以映射为稳定 Part；
- 一次 Session 只允许一个 Run，SSE 在同步 Message Request 前打开；
- 同步 Message Response 是成功终态的唯一 Authority，`session.idle` 不能代替它；
- `run.cancel()` 只有 Abort Route 成功且 Message Response 为
  `MessageAbortedError` 时才是原生取消；
- Permission Event 映射为 Approval，`once`、`reject` 与显式 `always` 保持区别。

如果 Run 远端状态不确定，Adapter 会隔离对应 Session，防止后续工作错误复用它。断流、HTTP
Error、畸形 Event 和未知 Terminal Shape 绝不会变成 `run.completed`。

## 兼容性与限制

连接时校验 Health，使用到的 Session、Message、Abort、Permission 和 Event
Shape 都会在运行时校验。Runtime Version 只用于诊断，不是能力推断或白名单。

当前稳定接口已有 Fixture、负例、共享 Conformance 和 Live
Evidence。不支持自动 SSE 重连、OpenCode Process 管理、Portable
Close 删除远端 Session，以及把 Command 或 Plugin 宣称为 Core
Capability。详细选项、证据版本和 Native Client 见 [英文详细文档](./README.md)。

## 原生会话历史操作

`opencode.sessions` 提供 `OpenCodeSessions.fork(ref)`，调用原生
`POST /session/{id}/fork`。先检查状态、身份和目录，再复制历史；子会话使用不同的原生 ID，并保留 Harapter 的模型及 system 默认值。上游不会复制会话权限规则或 revert 状态，因此存在这些状态时会在修改前拒绝分叉。不接受消息锚点，避免上游遇到未知锚点时静默复制全部历史。写入结果不确定时隔离父会话；明确的前置条件 HTTP 拒绝仍允许继续使用。

请在父 Run 已结束后调用。宿主必须保证所有 Client 和外部写入方都不会同时修改父会话；本地预留不能锁住其他进程。子引用仍绑定原 Provider／Profile。portable
`session.fork` 保持不支持，因为这些原生操作的历史范围和父生命周期不同。

```ts
import {
  OPENCODE_SESSION_EXTENSION,
  type OpenCodeSessions,
} from 'harapter/opencode';

const sessions = client
  .extensions()
  .get<OpenCodeSessions>(OPENCODE_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.fork(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

官方运行时、fixture、测试版本和复现命令见[会话分叉证据](../../docs/provider-session-fork-evidence.md)。测试使用真实 Runtime 和本机合成模型，不代表已调用托管模型服务。

## 相关包

[SDK 指南](../../README.zh-CN.md#一个-sdk)

| 包                                                               | 文档                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [使用指南](../../packages/core/README.zh-CN.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [使用指南](../../packages/conformance/README.zh-CN.md) |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [使用指南](../codex/README.zh-CN.md)                   |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)         | [使用指南](../dsh/README.zh-CN.md)                     |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [使用指南](../hermes/README.zh-CN.md)                  |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [使用指南](../openclaw/README.zh-CN.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [使用指南](../pi/README.zh-CN.md)                      |
