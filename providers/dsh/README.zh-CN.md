<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-dsh</code></h1>

<p align="center"><strong>把 DeepSeek Harness 官方 SDK Runtime 协议映射为 Harapter。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-dsh/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-dsh?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-dsh` 连接 DeepSeek Harness SDK
Runtime 暴露的换行分隔 JSON-RPC 2.0
Server，并把 Session、Run、Event、Interaction、取消和错误映射到 Harapter。它不会嵌入或复制 DeepSeek
Harness Agent Loop。

## 前置条件与安装

宿主自行安装、组合、配置和认证 DeepSeek Harness。Harapter 不包含 DSH CLI、SDK
Package、Cordis Application、Plugin、Model Adapter 或 Credential。

```bash
pnpm add @harapter/core@next @harapter/adapter-dsh@next
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  DSH_PROVIDER_ID,
  createDshProviderFactory,
} from '@harapter/adapter-dsh';

const registry = new HarnessRegistry();
registry.register(createDshProviderFactory());

const client = await registry.connect({
  profileId: profileId('dsh-local'),
  providerId: DSH_PROVIDER_ID,
  displayName: 'Local DeepSeek Harness',
  connection: {
    kind: 'process',
    command: 'dsh',
    args: ['--profile', 'sdk'],
    ownership: 'adapter',
  },
  providerOptions: {
    provider: 'host-configured-provider',
    model: 'host-configured-model',
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

## Profile 与生命周期

- 只接受 Adapter 拥有的 `process` Connection，并且不会使用 Shell；
- Profile 必须提供非空 `provider` 和
  `model`，还可设置 Reasoning、Token 与有界传输参数；
- Workspace 必须与 Runtime 初始化目录一致；Session 级 Model、System
  Context 和 Metadata 不受支持；
- 当前协议没有 Resume 与 Native Session Close；`session.close()`
  只释放本地 Handle；
- 整条 Connection 同时只有一个 Run；普通文本按官方 SDK 消息发送；
- `session/prompt` 只返回持久的 Inbox
  `messageId`，不是 Result 或终态 Authority；归属活动区间内唯一有效的
  `turn/end.data.reason` 才决定终态，EOF 或 Process Exit 不会成为成功；
- 当前协议没有 Prompt Cancel，`run.cancel`
  因此不受支持；Timeout 会关闭所属 Connection 并得到
  `connection_aborted`，上游观测到的 `aborted` 可映射为
  `run.cancelled`，但不证明 Harapter 发起了 Native Cancel；
- 未知通知进入有界、脱敏 Observation，不会被猜测为终态。

## 兼容性与 Evidence

连接会验证 `deepseek-harness-sdk-runtime`
身份以及实际使用的每个 Response、Event 和 Terminal 结构。Runtime 会报告诊断 Version，但协议没有协商版本，因此不使用版本白名单：新版本默认尝试，结构不兼容时在边界 fail
closed。

官方 SDK Profile 已通过合成 Fixture、Mapping
Test、共享 Conformance 和真实 Runtime 生命周期验证。Adapter 仍显示
`experimental`，表示任意连接的 Runtime无法在执行前自动绑定到已验证证据，而不是“没有实现或没有跑过”。生产环境可以固定文档记录的验证版本以获得可复现部署。

Native Client、Interaction、取消细节、最后验证版本、Live Test 与全部限制见
[英文详细文档](./README.md)。
