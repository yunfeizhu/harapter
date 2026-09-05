<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/core</code></h1>

<p align="center"><strong>Harapter 的 Provider 无关生命周期与注册中心。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/core` 为多个 Agent Harness 提供同一套 TypeScript
API。它定义 Client、Session、Run、事件流、终态、能力、错误、交互和 Provider 扩展，但不导入任何 Provider
SDK，也不会根据 Provider 名称推断行为。

## 适合什么场景

- 应用需要在 Codex、OpenCode 或其他 Adapter 之间切换，而业务流程保持不变；
- 需要按运行时实际能力选路，而不是在代码里判断 Provider 名称；
- 正在实现 Provider Adapter，需要标准契约、所有权校验和 Native Escape Hatch。

## 安装

预发布版本使用 `next` 标签：

```bash
pnpm add @harapter/core@next
```

下面不依赖 Provider 的示例还需要测试包：

```bash
pnpm add -D @harapter/conformance@next
```

Node.js 需要 24 或更高版本。Core 不会安装或登录任何 Harness Runtime。

## 30 秒上手

下面使用 `@harapter/conformance` 的 Fake
Provider，因此不需要凭据或真实 Runtime：

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });

  for await (const event of run.events()) {
    console.log(event.type);
  }

  const result = await run.result();
  console.log(result.status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

实际项目需要把 Fake Provider 换成一个
[已实现 Adapter](../../providers/README.md)，并由宿主安装、配置和认证对应 Runtime。

## 常见用法

### 在连接前声明必需能力

Profile 的 `requiredCapabilities` 默认只接受
`native`。如果宿主接受较弱模式，必须显式列出：

```ts
const client = await registry.connect({
  ...profile,
  requiredCapabilities: [
    { name: 'input.text' },
    { name: 'run.stream', acceptedModes: ['native', 'adapter_controlled'] },
  ],
});
```

### 正确区分终态

`run.result()` 是权威结果。`completed`、`cancelled`、`failed` 和
`connection_aborted` 不能互相替代；进程退出或连接中断不等于原生取消。

### 保存并恢复 Session

仅在能力清单允许时持久化
`session.ref()`。引用必须继续交给创建它的同一 Provider 和 Profile；Harapter 不提供跨 Provider
checkpoint 迁移。

## 主要导出

- `HarnessRegistry`：注册 Adapter Factory 并连接 Profile；
- `HarnessClient`、`HarnessSession`、`HarnessRun`：可移植生命周期；
- `HarnessEvent`、`RunResult`：有序事件和唯一终态；
- `CapabilityManifest`：区分原生、模拟、Adapter 控制、不支持和未知；
- `HarnessError`：稳定错误类别与明确的 `retryable`；
- `ExtensionRegistry`、`native()`：Provider 绑定的扩展边界；
- `assertSessionOwnership()`、`assertSessionCompatibility()`：恢复前校验所有权和兼容性。

## 安全与限制

- Core 不解析 `providerState`，也不负责凭据、Runtime 安装、进程策略或持久化；
- 不应默认记录 Provider 原始事件、`providerState`、`providerResult`、提示词或凭据；
- 可选的 resume、cancel、interaction、artifact 和 usage 行为取决于当前能力清单；
- API 仍处于 pre-alpha，1.0 前可能发生破坏性调整。

完整字段、生命周期与错误契约见[英文详细文档](./README.md)和
[API 设计](../../docs/design/api-design.zh-CN.md)。
