<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-hermes</code></h1>

<p align="center"><strong>通过 HTTP 与 SSE 把 Hermes Agent API Server 接入 Harapter。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-hermes/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-hermes?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-hermes` 把 Hermes Agent 官方 API
Server 的 Session、Run、状态查询、SSE
Event、Stop 和 Approval 映射为 Harapter。宿主负责安装、认证、启动、停止和配置 Hermes
Agent；Adapter 只连接指定 HTTP Endpoint。

## 安装

```bash
pnpm add @harapter/core@next @harapter/adapter-hermes@next
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

const registry = new HarnessRegistry();
registry.register(createHermesProviderFactory());

const client = await registry.connect({
  profileId: profileId('hermes-local'),
  providerId: HERMES_PROVIDER_ID,
  displayName: 'Hermes Agent',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:8642/',
    transport: 'http',
    ownership: 'host',
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

需要认证时，Factory 接收宿主实现的 `resolveAuthHeaders`，Connection 只保存
`authRef`。Harapter 不读取、打印或持久化真实 Header。

## Session 与 Run

- Connection 必须通过 `/v1/capabilities` 声明 Adapter 使用的 Route；
- Session 创建可传 System Context 和 Model；Resume 会重新校验 Native
  Session 与所有权；
- Workspace 不受支持，`session.close()` 只释放 Handle，不删除远端 Session；
- 一个 Session 同时只有一个 Run，输入目前只支持文本；
- Submit Ack 不是终态，Adapter 会消费 SSE 并用 Run Status Route 做权威对账；
- `completed` 还必须匹配 Session、Run 与最后的 `run.completed` Evidence；
- SSE EOF、断连、重复或矛盾终态、畸形 Payload 都不会变成成功；
- Stop 和 Approval 只在 Runtime 明确声明对应 Feature 与 Route 时提供。

非幂等 Mutation 在响应丢失或结果不确定后会隔离 Session，避免不安全重试。Timeout 由 Harapter 发起时属于模拟控制；只有 Provider 权威
`cancelled` Status 才是取消终态。

## 兼容性与限制

Capability 来自实际 `/v1/capabilities`
响应，而不是 Hermes 名称或版本。每个用于生命周期判断的 Response 与 SSE
Event 都会进行结构校验。API Server 没有协议版本协商，所以 Adapter 保持
`experimental`；已记录真实 Runtime 完成、Resume 与 Native Cancel
Evidence，新版本默认尝试并在不兼容结构处 fail closed。

目前不支持 Portable Workspace、Remote Session Delete、自动 SSE
Reconnect 或未声明 Route。完整 Provider Options、Approval、Native Client、Live
Test 和最后验证版本见 [英文详细文档](./README.md)。
