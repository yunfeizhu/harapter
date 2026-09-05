<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-openclaw</code></h1>

<p align="center"><strong>通过稳定 ACP v1 驱动隔离的 OpenClaw Gateway Session。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-openclaw/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-openclaw?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-openclaw` 启动官方 `openclaw acp` stdio Bridge，将稳定 ACP v1
Session、Prompt、Event、Permission、Resume 与取消映射为 Harapter。宿主负责安装、配置、认证和运行 OpenClaw
Gateway。

## 安装

```bash
pnpm add @harapter/core@next @harapter/adapter-openclaw@next
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
