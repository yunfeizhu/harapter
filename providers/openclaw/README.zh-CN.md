<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-openclaw</code></h1>

<p align="center"><strong>通过稳定 ACP v1 驱动隔离的 OpenClaw Gateway Session。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-openclaw?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-openclaw?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-openclaw` 启动官方 `openclaw acp` stdio Bridge，将稳定 ACP v1
Session、Prompt、Event、Permission、Resume 与取消映射为 Harapter。宿主负责安装、配置、认证和运行 OpenClaw
Gateway。

## 在自己的应用中快速接入

使用 Node.js 24+ ESM 项目，把下面的完整示例保存为
`app.ts`，不需要 Harapter 仓库或私有导入。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-openclaw
npm install -D typescript @types/node
```

### 宿主需要提供的配置

| 环境变量                    | 配置值                                               |
| --------------------------- | ---------------------------------------------------- |
| `HARAPTER_OPENCLAW_COMMAND` | 已安装的 OpenClaw 命令；宿主须先运行并认证 Gateway。 |
| `HARAPTER_WORKSPACE`        | 已有空测试目录的绝对路径；OpenCode 使用服务端目录。  |

凭证只保留在 Runtime 或宿主环境中，不写入代码或 Session 引用。首次调用使用空测试工作区及经过宿主确认的禁用工具／只读配置。

按下表提供配置后执行 `node app.ts`。程序持续消费事件，最终文本位于
`result.finalMessage`，并始终清理资源。stdout 只输出元数据，内容应交给受控业务响应。模型调用可能消耗 token 并创建原生 Session 数据。

<!-- sdk-example: quick-openclaw.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenClawProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-openclaw'),
    providerId: OPENCLAW_PROVIDER_ID,
    displayName: 'Application openclaw',
    connection: {
      kind: 'process',
      command: required('HARAPTER_OPENCLAW_COMMAND'),
      args: ['acp', '--no-prefix-cwd'],
      cwd: workspace,
      ownership: 'adapter',
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
    // ACP session/close needs an open connection after the Run has settled.
    await session.close();
  } catch (error) {
    // On failure, abort any active Run and preserve the original error.
    await client.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    throw error;
  }
  await client.close();
}

await main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/org/harapter)

## 安装

```bash
pnpm add @harapter/core @harapter/adapter-openclaw
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

const registry = new HarnessRegistry();
registry.register(createOpenClawProviderFactory());

const client = await registry.connect({
  profileId: profileId('openclaw-local'),
  providerId: OPENCLAW_PROVIDER_ID,
  displayName: 'OpenClaw',
  connection: {
    kind: 'process',
    command: 'openclaw',
    args: ['acp'],
    ownership: 'adapter',
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

## Session 与 Run

- 初始化必须协商稳定 ACP v1，并验证 Implementation Name 为 `openclaw-acp`；
- 新 Session 使用显式隔离的 Gateway Session Key，Native
  ID 和路由状态绑定到 Profile；
- Resume 要求相同 Provider、Profile、Compatibility 与隔离 Route；
- 整条 ACP Connection 同时只运行一个 Run，避免未知 Event 被错误分配；
- 支持非空文本和握手声明的 Image Reference，Generic File 与 Native
  Input 不受支持；
- 验证通过的 ACP Prompt Response 是唯一终态 Authority；
- `run.cancel()` 必须得到 Authoritative `cancelled` Response 才是 Native
  Cancel；
- Permission Request 动态把 Approval Capability 从 `unknown` 提升为 `native`；
- 未知 ACP 消息通过有界、脱敏 Observation 保持可见，不保存 Prompt、路径或 Tool 内容。

本地 timeout/abort 无法确认远端 Mutation 时，Adapter 会中止 Connection，绝不把它当成取消或成功。`end_turn`
是完成；`refusal`、`max_tokens` 和 `max_turn_requests` 是失败；EOF、Process
Loss 与 Queue Overflow 是 `connection_aborted`。

## 兼容性与限制

稳定 ACP
v1 提供可协商协议版本，因此 Runtime 身份和必需结构可在连接阶段验证。当前 Adapter 有 Fixture、Provider
Negative、共享 Conformance，以及真实完成、跨 Client Resume 和 Native
Cancellation Evidence。

当前不覆盖共享 Gateway Session 路由、History Replay、Session MCP、Audio、Generic
File、Filesystem/Terminal Client Service、自动 Process Restart 或直接 Gateway
WebSocket。Workspace 会传给 ACP，但 Tool 实际执行目录仍为
`unknown`。完整 Evidence、Live Test、安全隔离与 Native
Extension 见[英文详细文档](./README.md)。

## 原生会话历史操作

ACP 不声明分叉。需要在 `createOpenClawProviderFactory({ gateway })` 中显式提供
`OpenClawGatewayBinding`：`profileId` 必须与 ACP Profile 一致，`methods`
来自该 Gateway 的 hello，`request(method, params, { signal })`
调用它已认证的 RPC。宿主必须保证它和 ACP 连接同一个 Gateway／存储，并负责认证、重连和销毁。Harapter 不自动发现或安装连接；只有观察到
`sessions.list` 和 `sessions.create` 时才公开 `openclaw.gateway.sessions`。

`OpenClawSessions.fork(ref)` 检查准确的隔离路由和父策略，以 `fork: true`、
`forkFrom: last-completed` 调用
`sessions.create`，不提交输入、不触发命令 hooks。验证原生血缘、权限和目录继承后，用
`requireExisting: true`
把子会话接到 ACP。无法证明完整继承的 worktree/session-root、远程执行、子 Agent 所有权、会话级
`sendPolicy`、无痕和私有访问状态会被拒绝。分叉期间拒绝新的 ACP 操作；写入或接入结果不确定时关闭 ACP
Client。每次 RPC 都受 `operationTimeoutMs`
限制，即使宿主忽略 AbortSignal；宿主仍负责自己的 Gateway 连接。

请在父 Run 已结束后调用。宿主必须保证所有 Client 和外部写入方都不会同时修改父会话；本地预留不能锁住其他进程。子引用仍绑定原 Provider／Profile。portable
`session.fork` 保持不支持，因为这些原生操作的历史范围和父生命周期不同。

```ts
import {
  OPENCLAW_SESSION_EXTENSION,
  type OpenClawSessions,
} from '@harapter/adapter-openclaw';

const sessions = client
  .extensions()
  .get<OpenClawSessions>(OPENCLAW_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.fork(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

官方运行时、fixture、测试版本和复现命令见[会话分叉证据](../../docs/provider-session-fork-evidence.md)。测试使用真实 Runtime 和本机合成模型，不代表已调用托管模型服务。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                                       | 文档                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                         | [使用指南](../../packages/core/README.zh-CN.md)        |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)           | [使用指南](../../packages/conformance/README.zh-CN.md) |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)       | [使用指南](../codex/README.zh-CN.md)                   |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)           | [使用指南](../dsh/README.zh-CN.md)                     |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)     | [使用指南](../hermes/README.zh-CN.md)                  |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode) | [使用指南](../opencode/README.zh-CN.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [使用指南](../pi/README.zh-CN.md)                      |
