<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-codex</code></h1>

<p align="center"><strong>通过 Harapter 可移植生命周期运行稳定版 Codex App Server。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-codex"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-codex?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-codex"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-codex?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-codex` 连接 Codex 官方稳定 App
Server，把 Thread、Turn、流式 Event、Interaction、终态和原生中断映射为 Harapter
API。它使用公开机器接口，不解析面向人的 CLI 文本。

## 前置条件

宿主负责安装并认证 Codex。Adapter 不包含 Codex Binary、不读取凭据、不解析
`SecretRef`，也不替宿主选择 Sandbox 或 Approval Policy。

```bash
pnpm add @harapter/core @harapter/adapter-codex
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';

const registry = new HarnessRegistry();
registry.register(createCodexProviderFactory());

const client = await registry.connect({
  profileId: profileId('codex-local'),
  providerId: CODEX_PROVIDER_ID,
  displayName: 'Local Codex',
  connection: {
    kind: 'process',
    command: 'codex',
    args: ['app-server', '--stdio'],
    ownership: 'adapter',
  },
  requiredCapabilities: [{ name: 'input.text' }, { name: 'run.stream' }],
});

const session = await client.createSession({
  providerOptions: {
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
  },
});

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

## 映射与常见用法

- Codex Thread 对应 Session，Turn 对应 Run；同一 Thread 同时只能有一个 Turn；
- 文本和 Image Reference 是可移植输入，任意 File Reference 不受支持；
- 稳定的 Command 与 File Change Request 映射为 Approval Interaction；
- `session.ref()` 只可恢复到相同 Provider、Profile 和兼容 App Server；
- `run.cancel()` 只有在 `turn/interrupt` 后收到权威 `interrupted`
  终态时才算原生取消；
- `CodexNativeClient` 可访问显式 Provider 能力，但不获得可移植生命周期保证。

`turn/completed`
是唯一权威终态。未知或畸形终态不会被猜为成功；进程退出、EOF、Client
Close 或未确认的 Interrupt 会得到 `connection_aborted`。

## 配置与安全

Profile 只接受 Adapter 拥有的 `process`
连接。可配置消息、队列、请求、取消等待和 Run
Event 上限；未知选项会被拒绝。未消费 Event 导致 Queue 满时，Adapter 会中止连接而不是丢弃数据。

错误不会包含 Provider
Message、Prompt、文件内容、凭据、环境变量或本地路径。未知上游通知通过有界、脱敏的 Raw
Channel 保持可观察。

当前稳定 App Server 已有 Fixture、映射测试、共享 Conformance 和真实 Runtime
Evidence。精确兼容范围、Provider Options、Live Test 和未支持能力见
[英文详细文档](./README.md)。

## 原生会话历史操作

`openai.codex.sessions` 提供
`CodexSessions.fork(ref)`。Adapter 先读取父 Thread，确认它已持久化且空闲或未加载，再调用稳定的
`thread/fork`，不提交新 Turn。子 Thread 必须具有不同的 ID 和匹配的
`forkedFromId`。不接受临时 Thread，也不提供运行配置覆盖选项；持久化设置由 Codex 原生继承。修改结果不确定时关闭连接；明确的 RPC 拒绝不会使父会话失效。

请在父 Run 已结束后调用。宿主必须保证所有 Client 和外部写入方都不会同时修改父会话；本地预留不能锁住其他进程。子引用仍绑定原 Provider／Profile。portable
`session.fork` 保持不支持，因为这些原生操作的历史范围和父生命周期不同。

```ts
import {
  CODEX_SESSION_EXTENSION,
  type CodexSessions,
} from '@harapter/adapter-codex';

const sessions = client
  .extensions()
  .get<CodexSessions>(CODEX_SESSION_EXTENSION);
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
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)           | [使用指南](../dsh/README.zh-CN.md)                     |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)     | [使用指南](../hermes/README.zh-CN.md)                  |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw) | [使用指南](../openclaw/README.zh-CN.md)                |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode) | [使用指南](../opencode/README.zh-CN.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [使用指南](../pi/README.zh-CN.md)                      |
