<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/dsh</code></h1>

<p align="center"><strong>把 DeepSeek Harness 官方 SDK Runtime 协议映射为 Harapter。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

本指南描述单个 `harapter`
SDK 内的模块。普通应用接入请先看[应用指南](../../packages/harapter/README.zh-CN.md)。安装
`harapter` 即可，无需为此模块另装 npm 包。

同一包提供 [SDK process](#sdk-process-strategy) 与
[Gateway endpoint](#gateway-endpoint-策略)
两种连接策略；Gateway 增加原生恢复、分叉和 Session 范围取消。

`harapter/dsh` 连接 DeepSeek Harness SDK Runtime 暴露的换行分隔 JSON-RPC 2.0
Server，并把 Session、Run、Event、Interaction、取消和错误映射到 Harapter。它不会嵌入或复制 DeepSeek
Harness Agent Loop。

## 在自己的应用中快速接入

使用 Node.js 24+ ESM 项目，把下面的完整示例保存为
`app.ts`，不需要 Harapter 仓库或私有导入。

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

### 宿主需要提供的配置

| 环境变量                | 配置值                                               |
| ----------------------- | ---------------------------------------------------- |
| `HARAPTER_DSH_COMMAND`  | 已安装 DSH 命令，需先完成 sdk-minimal Profile 配置。 |
| `HARAPTER_DSH_PROVIDER` | 该 DSH Profile 已配置的模型 Provider 路由。          |
| `HARAPTER_DSH_MODEL`    | 此路由可使用的模型 ID。                              |
| `HARAPTER_WORKSPACE`    | 已有空测试目录的绝对路径；OpenCode 使用服务端目录。  |

凭证只保留在 Runtime 或宿主环境中，不写入代码或 Session 引用。首次调用使用空测试工作区及经过宿主确认的禁用工具／只读配置。

按下表提供配置后执行 `node app.ts`。程序持续消费事件，最终文本位于
`result.finalMessage`，并始终清理资源。stdout 只输出元数据，内容应交给受控业务响应。模型调用可能消耗 token 并创建原生 Session 数据。

<!-- sdk-example: quick-dsh.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { DSH_PROVIDER_ID, createDshProviderFactory } from 'harapter/dsh';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createDshProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-dsh'),
    providerId: DSH_PROVIDER_ID,
    displayName: 'Application dsh',
    connection: {
      kind: 'process',
      command: required('HARAPTER_DSH_COMMAND'),
      args: ['--profile', 'sdk-minimal'],
      cwd: workspace,
      ownership: 'adapter',
    },
    providerOptions: {
      provider: required('HARAPTER_DSH_PROVIDER'),
      model: required('HARAPTER_DSH_MODEL'),
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
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/package/harapter)

## 前置条件与安装

宿主自行安装、组合、配置和认证 DeepSeek Harness。Harapter 不包含 DSH CLI、SDK
Package、Cordis Application、Plugin、Model Adapter 或 Credential。

```bash
pnpm add harapter
```

## SDK process strategy

### 快速开始

```ts
import { HarnessRegistry, profileId } from 'harapter';
import { DSH_PROVIDER_ID, createDshProviderFactory } from 'harapter/dsh';

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

### Profile 与生命周期

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

### 兼容性与 Evidence

连接会验证 `deepseek-harness-sdk-runtime`
身份以及实际使用的每个 Response、Event 和 Terminal 结构。Runtime 会报告诊断 Version，但协议没有协商版本，因此不使用版本白名单：新版本默认尝试，结构不兼容时在边界 fail
closed。

官方 SDK Profile 已通过合成 Fixture、Mapping
Test、共享 Conformance 和真实 Runtime 生命周期验证。Adapter 仍显示
`experimental`，表示任意连接的 Runtime无法在执行前自动绑定到已验证证据，而不是“没有实现或没有跑过”。生产环境可以固定文档记录的验证版本以获得可复现部署。

Native Client、Interaction、取消细节、最后验证版本、Live Test 与全部限制见
[英文详细文档](./README.md)。

## Gateway endpoint 策略

需要原生持久化、恢复或分叉时，使用宿主管理的 Gateway。上面的 SDK
process 策略继续保留。Gateway 为实验性支持，仅针对官方提交
[`d347e703908d0406b7a7ef80e3a0e594d86b2215`](https://github.com/deepseek-ai/deepseek-harness/tree/d347e703908d0406b7a7ef80e3a0e594d86b2215)
的 Session v2 协议，源码包版本为
`@deepseek-ai/dsh-api-session-controller@0.1.3-alpha.1`。这不是同版本 npm 包已经发布的声明。宿主通过
`DSH_GATEWAY_PROTOCOL` 明确确认配置对应此协议；连接时的 `session/modelCatalog`
探测和结构校验不能证明 Runtime 版本、存储身份、独占访问或工具策略。

### 认证与宿主责任

宿主启动 DSH，管理原生存储、模型、工具和交互策略，并通过 `resolveGatewayCookie`
提供签名的 browser-session cookie。Resolver 接收配置中的 `SecretRef`
和受超时约束的 `AbortSignal`。正式根页面的 launch
token 换取 cookie 流程及凭据持久化均由宿主负责；Bearer API
key 不能替代 Gateway 认证。Harapter 不读取浏览器配置或 Runtime 凭据文件。HTTP 与 WebSocket 使用同一 cookie 和明确配置的 Origin，拒绝重定向。端点必须是 HTTPS 根 authority，或 loopback
HTTP；不得包含凭据、query、fragment。仅接受 `host` 或 `external`
ownership，transport 可省略或设为 `websocket`。

`storeId` 是宿主提供的不透明存储身份，仅在同一原生存储保留期间保持稳定。
`exclusiveSessions: true` 表示宿主保证其他客户端、DSH
UI 和插件不会向这些 Session 注入竞争工作，并不构成上游锁。交互策略必须由宿主明确配置，当前不支持 portable
interaction response。

```ts
import { profileId, type SecretRef } from 'harapter';
import {
  createDshProviderFactory,
  DSH_PROVIDER_ID,
  DSH_GATEWAY_PROTOCOL,
  DSH_GATEWAY_SESSION_EXTENSION,
  type DshGatewaySessions,
} from 'harapter/dsh';

// Supplied by the host's credential service.
declare function resolveCookie(
  ref: SecretRef,
  signal: AbortSignal,
): Promise<string>;
const factory = createDshProviderFactory({
  resolveGatewayCookie: resolveCookie,
});
const client = await factory.connect({
  providerId: DSH_PROVIDER_ID,
  profileId: profileId('dsh-gateway'),
  displayName: 'Host DSH Gateway',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:3000',
    ownership: 'external',
    authRef: { scheme: 'host-vault', id: 'dsh-cookie' },
  },
  providerOptions: {
    protocol: DSH_GATEWAY_PROTOCOL,
    storeId: 'host-managed-store-identity',
    exclusiveSessions: true,
  },
});
try {
  const session = await client.createSession();
  const run = await session.start({
    parts: [{ type: 'text', text: 'Hello.' }],
  });
  for await (const event of run.events()) {
    /* Host rendering. */
  }
  const result = await run.result();
  if (result.status === 'completed') {
    const controls = client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
    const child = await controls?.fork(session.ref());
    // Persist child.ref() under the host's Session storage policy.
    await child?.close();
  }
  await session.close();
} finally {
  await client.close();
}
```

### 生命周期与原生控制

精确的 inbox 插入和未标记 canceled 的领取记录建立请求归属，因此在 `user/message`
之前发生的取消或 pre-step 拒绝也可正确结束。仅在已归属的 step 内接受官方
`@deepseek-ai/dsh-system-prompt` 上下文消息，其他插件注入仍不支持。`turn/end`
后、回执前的连续异步标题事件不会改变已验证结果。超限文本在占有 Run 前拒绝；明确的上游前置条件拒绝会释放占有，保留 Client。

`createSession()` 不接受 Session 选项，使用宿主默认配置。Adapter 先打开
`session/follow`，校验连续的 Session v2 历史，再以 queue 模式提交文本，并将
`user/message.source.rpcId`
与本次 request 关联。历史不会作为新 Run 输出。每个 Client 同时只允许一个 Run；输出持久化的完整 Assistant
Message，不提供瞬时 token delta。只有经过校验且属于本次请求的 `turn/end`
能确定终态，受理回执本身不能证明成功。

`resumeSession(ref)`
必须匹配原 Provider、Profile、endpoint、protocol、store 和 header 身份。会话缺失时绝不通过 create 替代。只接受普通 Session 的完整 opening
history：最多 4096 个事件，请求最多 200 条消息，同时受帧大小限制；截断历史和 subagent-owned
reference 会被拒绝。宿主保留相同存储并更新认证后，可以显式恢复 Runtime 重启前的原生状态；不透明重连，也不恢复中断的 Run。

`DSH_GATEWAY_SESSION_EXTENSION` 为 `deepseek.harness.gateway.sessions`。
`DshGatewaySessions.fork(ref)`
从最近完整 turn 的前缀创建独立原生子 Session，父 Session 必须已附着；不接受任意 cursor，并验证返回 lineage。Core 没有 fork 方法，因此 portable
`session.fork` 仍不支持。 `cancelSession(ref)`
请求 Session 范围的原生取消，保留 inbox，返回
`{ accepted: true }`。受理与实际取消终态分别观察；回合尚未开始时取消可能只保留排队输入而不产生取消终态，本地 Run 期限仍生效。上游没有条件式 Run
selector，因此 portable `run.cancel` 仍不支持。 `DshGatewayNativeClient`
暴露相同的有限控制、protocol 和哈希绑定身份，不提供任意 Gateway RPC。

关闭句柄只取消观察。关闭 Client、断流、本地 Run 超时、未知必需事件或缓冲溢出会使活动 Run 以
`connection_aborted`
结束，外部 Agent 仍可能继续；这些动作不会删除会话或停止 DSH。写操作结果不确定时隔离整个 Client，不自动重试；确定的前置条件拒绝允许继续使用。Session
mutation 尚未完成时不接受新 Run。

### 限制、错误与验证

额外选项及默认值为 `requestTimeoutMs: 30000`、`runTimeoutMs: 120000`、
`maxMessageBytes: 262144`（最多 1048576）、`maxBufferedEvents: 32`（最多 256）、
`maxRunEvents: 128`（最多 4096）、`maxSessions: 4`（最多 16）。Timer 必须为不超过 2147483647 的正安全整数，事件队列保留终态位置，Stream 与 Run 的组合接收预算最多 64
MiB。未消费事件有界且不会静默丢弃。 `DSH_NOTIFICATION_EXTENSION`
也能观察附着 Session 的脱敏 snapshot 与空闲事件，最多 16 个监听器；未知必需事件先进入此通道再终止连接。监听器不能影响生命周期，raw 使用与 SDK 相同的有界脱敏。

错误分别使用
`profile_invalid`、`authentication_failed`、`provider_api_incompatible`、
`session_not_found`、`session_provider_mismatch`、`run_conflict`
等稳定类别；消息固定，provider
code 采用白名单，不泄漏上游错误或凭据。关闭连接不会撤销宿主 cookie。

[Gateway fixtures](../../fixtures/dsh/gateway-session-v2/manifest.json)、wire/mapping/lifecycle 负向测试与 shared
conformance 构成确定性证据。2026-09-07 在隔离环境构建固定提交的官方 CLI、Gateway、Agent
Loop 和 JSONL
persistence，使用本地模拟模型验证创建、完成、分叉、子会话继续、重连恢复、Session
cancel 以及完整 Runtime 进程重启恢复。未挂载工具插件；这是官方 Runtime 配合模拟模型的证据，不是真实外部模型验证。

运行 `pnpm vitest run providers/dsh/test/gateway-live.test.ts` 前，配置
`HARAPTER_DSH_GATEWAY_LIVE=1`、`HARAPTER_DSH_GATEWAY_URL`、
`HARAPTER_DSH_GATEWAY_STORE_ID`、`HARAPTER_DSH_GATEWAY_COOKIE_FILE`。最后一项必须是宿主专门创建的测试凭据文件，不是 Runtime 凭据库。使用隔离、无工具的固定版本 Gateway，让本地模拟模型前两次返回
`HARAPTER_DSH_GATEWAY_LIVE_OK`，第三次等待取消。此测试覆盖 Client 重连；完整进程重启另有宿主验证记录。跳过不算兼容证据。安装、插件管理、任意 Session 选项、文件/图片、交互、竞争写入、历史分页和精确 portable
cancellation 不在本策略范围内。

## 相关包

[SDK 指南](../../README.zh-CN.md#一个-sdk)

| 包                                                               | 文档                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [使用指南](../../packages/core/README.zh-CN.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [使用指南](../../packages/conformance/README.zh-CN.md) |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [使用指南](../codex/README.zh-CN.md)                   |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [使用指南](../hermes/README.zh-CN.md)                  |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [使用指南](../openclaw/README.zh-CN.md)                |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [使用指南](../opencode/README.zh-CN.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [使用指南](../pi/README.zh-CN.md)                      |
