<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/hermes</code></h1>

<p align="center"><strong>通过 HTTP 与 SSE 把 Hermes Agent API Server 接入 Harapter。</strong></p>

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
SDK 内的模块。普通应用接入请先看[应用指南](../../packages/harapter/README.zh-CN.md)。单包入口的首次发布尚待完成，下面的安装命令适用于该版本发布后。

`harapter/hermes` 把 Hermes Agent 官方 API Server 的 Session、Run、状态查询、SSE
Event、Stop 和 Approval 映射为 Harapter。宿主负责安装、认证、启动、停止和配置 Hermes
Agent；Adapter 只连接指定 HTTP Endpoint。

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

| 环境变量                  | 配置值                                                |
| ------------------------- | ----------------------------------------------------- |
| `HARAPTER_HERMES_URL`     | 已经运行的 Hermes API Server 地址。                   |
| `HARAPTER_HERMES_API_KEY` | API Server 的 bearer 凭证，模型凭证仍由 Hermes 管理。 |

凭证只保留在 Runtime 或宿主环境中，不写入代码或 Session 引用。首次调用使用空测试工作区及经过宿主确认的禁用工具／只读配置。

按下表提供配置后执行 `node app.ts`。程序持续消费事件，最终文本位于
`result.finalMessage`，并始终清理资源。stdout 只输出元数据，内容应交给受控业务响应。模型调用可能消耗 token 并创建原生 Session 数据。

<!-- sdk-example: quick-hermes.ts -->

```ts
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from 'harapter/hermes';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const factory = createHermesProviderFactory({
    resolveAuthHeaders: () =>
      Promise.resolve({
        authorization: 'Bearer ' + required('HARAPTER_HERMES_API_KEY'),
      }),
  });
  const client = await factory.connect({
    profileId: profileId('my-hermes'),
    providerId: HERMES_PROVIDER_ID,
    displayName: 'Application hermes',
    connection: {
      kind: 'endpoint',
      url: required('HARAPTER_HERMES_URL'),
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'env', id: 'hermes' },
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({});
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

## 安装

```bash
pnpm add harapter
```

## 快速开始

```ts
import { HarnessRegistry, profileId } from 'harapter';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from 'harapter/hermes';

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

## 原生会话历史操作

只有上游声明 `session_fork` 及其准确 endpoint 时，才提供
`nous.hermes-agent.sessions` 的
`HermesSessions.branch(ref)`。Hermes 会先把父会话标为
`end_reason: branched`，再创建继承消息及 system
context 的子会话。Harapter 会停用父会话，重新连接后也不允许继续使用父会话，所以方法明确命名为
`branch`。上游不会复制已存储的模型配置；分支前要求 `has_model_config`
明确为 false。请求发送后失败会隔离父会话，因为即使返回错误，父会话也可能已经被原生 API 停用。

请在父 Run 已结束后调用。宿主必须保证所有 Client 和外部写入方都不会同时修改父会话；本地预留不能锁住其他进程。子引用仍绑定原 Provider／Profile。portable
`session.fork` 保持不支持，因为这些原生操作的历史范围和父生命周期不同。

```ts
import { HERMES_SESSION_EXTENSION, type HermesSessions } from 'harapter/hermes';

const sessions = client
  .extensions()
  .get<HermesSessions>(HERMES_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.branch(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

官方运行时、fixture、测试版本和复现命令见[会话分叉证据](../../docs/provider-session-fork-evidence.md)。测试使用真实 Runtime 和本机合成模型，不代表已调用托管模型服务。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                               | 文档                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [使用指南](../../packages/core/README.zh-CN.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [使用指南](../../packages/conformance/README.zh-CN.md) |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [使用指南](../codex/README.zh-CN.md)                   |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)         | [使用指南](../dsh/README.zh-CN.md)                     |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [使用指南](../openclaw/README.zh-CN.md)                |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [使用指南](../opencode/README.zh-CN.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [使用指南](../pi/README.zh-CN.md)                      |
