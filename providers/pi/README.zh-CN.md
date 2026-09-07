<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-pi</code></h1>

<p align="center"><strong>通过 Harapter 运行 Pi Agent 的严格 JSONL RPC 模式。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-pi"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-pi?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-pi"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-pi?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-pi` 将官方 Pi Agent `--mode rpc`
接口映射为 Harapter。每个 Session 使用独立进程，支持流式 Event、持久化 Resume 和原生 Abort，同时禁用 Extension、Skill 与 Prompt
Template 自动发现，防止普通文本绕过 Agent 生命周期。

## 前置条件与安装

宿主安装、配置并认证 Pi
Agent，选择模型和绝对可执行文件路径。Harapter 不读取 Session
File、不管理 Credential，也不会安装 Runtime。

```bash
pnpm add @harapter/core @harapter/adapter-pi
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import { PI_PROVIDER_ID, createPiProviderFactory } from '@harapter/adapter-pi';

const registry = new HarnessRegistry();
registry.register(createPiProviderFactory());

const client = await registry.connect({
  profileId: profileId('pi-local'),
  providerId: PI_PROVIDER_ID,
  displayName: 'Pi Agent',
  connection: {
    kind: 'process',
    command: '/opt/harapter-runtimes/bin/pi',
    args: [],
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

## 进程、Session 与 Run

- Adapter 探测 `--version`，再为每个 Session 启动独立 RPC Process；
- 自动追加 `--no-extensions --no-skills --no-prompt-templates --mode rpc`；
- `persistSessions: false` 会加 `--no-session` 并关闭 Resume；
- Resume 会用 Native ID 启动新进程，并要求 Runtime 返回相同 Session；
- Workspace、System Context、Session Model 与 Metadata 不受支持；
- Portable Run 只接受文本，多段文本用换行连接；以 `/` 开头的输入会被拒绝；
- `prompt` Response 只表示接受，`agent_settled` 和最后一个有效 Assistant
  `message_end` 共同提供终态 Authority；
- `run.cancel()` 只有 `abort` Response 与 `stopReason: 'aborted'`
  终态相关联时才是 Native Cancel；
- Tool ID 会散列，Tool Argument/Result 不进入 Portable Event。

Pi Extension UI 的 select、confirm、input 和 editor 会映射为 Provider
Interaction，但不被提升为通用 Approval 或 User Input
Capability。未知 Event 会进入有界、脱敏的 Observation；Native
Client 只提供保持所有权的只读命令。

## 兼容性与限制

Pi RPC 会报告语义化 Runtime
Version，但没有可协商的协议版本。Adapter 不锁版本，会校验每个实际使用的 Response、Event 和 Terminal
Structure；因此当前状态为 `experimental`，同时已有真实完成、Resume、Native
Cancel 与清理 Evidence。

不支持 Image/File Input、Portable Model、Workspace、通用 Approval、Runtime
Extension/Skill、共享 Process、多 Session Multiplex、自动重启、Session File
Access 或任意 Native Mutation。完整 Options、Live Test 和最后验证版本见
[英文详细文档](./README.md)。

## 原生会话历史操作

启用持久化时，`pi.agent.sessions` 提供
`PiSessions.fork(ref)`。Adapter 使用独立的受管 RPC 进程打开准确的父会话，确认空闲后调用原生
`clone`，再通过 `get_state`
确认不同且空闲的子会话。父进程始终绑定原来的会话。克隆只复制当前活动分支，不复制源文件内的全部分支。拒绝、取消、畸形回执或超时只清理这次尝试的子进程，不会切换父会话。运行配置仍来自同一个宿主 Profile。

请在父 Run 已结束后调用。宿主必须保证所有 Client 和外部写入方都不会同时修改父会话；本地预留不能锁住其他进程。子引用仍绑定原 Provider／Profile。portable
`session.fork` 保持不支持，因为这些原生操作的历史范围和父生命周期不同。

```ts
import { PI_SESSION_EXTENSION, type PiSessions } from '@harapter/adapter-pi';

const sessions = client.extensions().get<PiSessions>(PI_SESSION_EXTENSION);
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
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode) | [使用指南](../opencode/README.zh-CN.md)                |
