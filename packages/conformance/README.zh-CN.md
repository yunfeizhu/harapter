<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/conformance</code></h1>

<p align="center"><strong>可复用的 Harapter 生命周期测试与确定性 Fake Provider。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/v/%40harapter%2Fconformance?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/dm/%40harapter%2Fconformance?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

这个包面向 Adapter 作者和 Harapter 应用测试。它提供共享的 Vitest 行为套件、Run
Trace 校验器，以及不依赖任何真实 Runtime 的 Fake
Provider。通过共享套件只证明可移植契约成立，不等于某个真实 Provider 已获得支持证据。

## 安装

```bash
pnpm add -D @harapter/conformance vitest@^4.1.11
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

## 共享交互套件

`defineInteractionConformanceSuite()` 按需启用。提供全新的 Factory/Profile、合成
`input`、交互 `kind`，以及非空的有效 `responses`
数组。Fixture 每次 Run 必须请求一次交互，并在响应后结束；支持审批时应同时测试允许和拒绝。每个用例使用两秒 Run 截止时间，并始终关闭 Client。

共享测试验证观察到的能力、事件所有权、单次解决、重复与跨 Session 响应拒绝、取消强度及断连后的请求失效。取消允许与权威终态竞争；原生畸形输入、过期、传输确认和协议顺序仍由 Provider 专项测试负责。Codex、OpenCode、Hermes、OpenClaw 和 Pi 已使用各自的合成协议 Fixture 接入；Pi 使用
`kind: 'provider'`，DSH 当前没有宿主响应接口，因此不启用该套件。

```ts
import { defineInteractionConformanceSuite } from '@harapter/conformance';

defineInteractionConformanceSuite({
  name: 'Example approval fixture',
  createFactory: createApprovalFixtureFactory,
  createProfile: createApprovalFixtureProfile,
  input: { parts: [{ type: 'text', text: 'synthetic approval input' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
```

示例中的两个 Fixture 创建函数由 Adapter 测试提供。

## 在 Vitest 外使用 Fake 交互

公共子路径 `@harapter/conformance/fake` 导出 `createFakeProfile`、
`createFakeProviderFactory`、默认身份和
`FakeProviderOptions`，不导入 Vitest，可用于离线 Node 演示。原包入口仍为 Vitest 使用者导出这些符号。

设置 `interaction: { kind: 'approval' }`，或使用 `user_input` /
`provider`，即可让每个 Fake
Run 发出一次请求并等待明确回答。其他可选请求字段必须是合成 Fixture 数据。不设置时仍为不支持交互的普通回显行为。Run 身份在 Factory 内唯一，只有启动 Run 的 Session 句柄能回答；类型不符、重复、跨 Session、关闭或过期后的回答都会失败。

观察到的 `run.timeout` 模式为 `adapter_controlled`。

拒绝审批会解决当前请求并正常结束合成 Run，不等于取消 Run。Fake 用户输入接受非空的文本片段数组；原生响应保留明确的 Provider 值。`RunOptions.timeoutMs`
接受不超过 2,147,483,647 的正安全整数。超时先发出 `interaction.resolved`，再发出
`connection.aborted`，释放等待者并清除计时器；原生取消仍为 `run.cancelled`。

[离线交互示例](../../examples/multi-provider-client/interactions.md)
可以实际体验该流程，不调用真实工具、Runtime 或模型。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                                                     | 文档                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [使用指南](../core/README.zh-CN.md)                    |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [使用指南](../transport-jsonrpc-stdio/README.zh-CN.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [使用指南](../transport-jsonl-process/README.zh-CN.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [使用指南](../transport-http-sse/README.zh-CN.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [使用指南](../transport-acp/README.zh-CN.md)           |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [使用指南](../../providers/codex/README.zh-CN.md)      |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [使用指南](../../providers/dsh/README.zh-CN.md)        |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [使用指南](../../providers/hermes/README.zh-CN.md)     |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [使用指南](../../providers/openclaw/README.zh-CN.md)   |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [使用指南](../../providers/opencode/README.zh-CN.md)   |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [使用指南](../../providers/pi/README.zh-CN.md)         |
