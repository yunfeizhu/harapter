<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/conformance</code></h1>

<p align="center"><strong>可复用的 Harapter 生命周期测试与确定性 Fake Provider。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/v/%40harapter%2Fconformance/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/dm/%40harapter%2Fconformance?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

这个包面向 Adapter 作者和 Harapter 应用测试。它提供共享的 Vitest 行为套件、Run
Trace 校验器，以及不依赖任何真实 Runtime 的 Fake
Provider。通过共享套件只证明可移植契约成立，不等于某个真实 Provider 已获得支持证据。

## 安装

```bash
pnpm add -D @harapter/conformance@next vitest@^4.1.11
```

## 在 Adapter 测试中使用

每个测试用例都必须得到全新的 Factory 和 Profile，避免状态在用例间泄漏：

```ts
import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createAdapterFactory, createTestProfile } from './test-support.js';

definePortableProviderConformanceSuite({
  name: 'Example Provider',
  createFactory: createAdapterFactory,
  createProfile: createTestProfile,
});
```

共享套件覆盖 Client 身份、Session 与 Run 所有权、事件顺序、唯一终态、取消强度、connection
abort、resume、扩展、native
access 和幂等清理。Provider 仍需自行补充协议解析、畸形输入、超时、竞态、脱敏、兼容性与 live-runtime 测试。

## 在应用测试中使用 Fake Provider

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory({ cancelMode: 'native' }));

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });
  await run.result();
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

Fake
Provider 只处理合成文本，一次 Session 只运行一个 Run。它可以配置 resume、不同取消模式、native
access，以及一个经过限制的未知 Provider 事件，适合验证宿主如何处理可选能力和边界情况。

## 针对 Fixture 校验 Run Trace

`validatePortableRunTrace()`
可用于 Provider 映射测试，检查序号单调、唯一终态以及 Event 与 `RunResult`
一致。它不会校验上游协议原始数据是否合法，原始边界仍由 Adapter 负责。

## 限制

- 这是开发依赖，不应作为真实 Provider 的兼容性证明；
- Fake Provider 不代表任何第三方 Harness 的实现；
- 共享套件只测试 Adapter 声明的可移植行为，不替代 Provider 专项负例和 live
  evidence。

完整测试项与配置选项见[英文详细文档](./README.md)。
