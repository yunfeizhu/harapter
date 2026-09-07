<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-opencode</code></h1>

<p align="center"><strong>把宿主运行的 OpenCode HTTP/SSE Server 接入 Harapter。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-opencode?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-opencode?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-opencode` 将当前稳定的 `opencode serve`
HTTP/OpenAPI 与 SSE 接口映射为 Harapter 生命周期。宿主负责安装、认证、启动和停止 Server；Adapter 只连接指定 Endpoint，不会隐式删除远端 Session。

## 安装

```bash
pnpm add @harapter/core @harapter/adapter-opencode
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';

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
} from '@harapter/adapter-opencode';

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

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                                       | 文档                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                         | [使用指南](../../packages/core/README.zh-CN.md)        |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)           | [使用指南](../../packages/conformance/README.zh-CN.md) |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)       | [使用指南](../codex/README.zh-CN.md)                   |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)           | [使用指南](../dsh/README.zh-CN.md)                     |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)     | [使用指南](../hermes/README.zh-CN.md)                  |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw) | [使用指南](../openclaw/README.zh-CN.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [使用指南](../pi/README.zh-CN.md)                      |
