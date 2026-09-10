<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="https://raw.githubusercontent.com/yunfeizhu/harapter/main/docs/assets/harapter-banner.png" alt="Harapter 将一个可移植核心连接到多种 Agent Harness Runtime" width="1200">
</p>

<h1 align="center">Harapter</h1>

<p align="center">
  <strong>为需要接入多个 Agent Harness 的应用提供一套与 Provider 无关的统一 TypeScript API。</strong><br>
  宿主使用同一套 Client、Session、Run、流式 Event、Capability 和 Error 生命周期编排不同 Runtime；各 Adapter 仍保留 Provider 的状态所有权、已观测 Capability 与原生 Extension。
</p>

<p align="center">
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.md">English</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.ja.md">日本語</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.zh-CN.md">API 参考</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/docs/design/README.zh-CN.md">设计</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/examples/README.md">示例</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/CONTRIBUTING.md">贡献</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/releases"><img src="https://img.shields.io/github/v/release/yunfeizhu/harapter?display_name=tag&amp;include_prereleases&amp;sort=semver&amp;style=flat-square&amp;label=release" alt="GitHub Release"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="https://github.com/yunfeizhu/harapter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

`harapter` 将不同 Agent Harness
Runtime 适配为同一套应用 API。接入 DSH、OpenCode、Codex、Hermes、OpenClaw 或 Pi，都使用统一的 Client、Session、Run、事件外层结构和最终结果契约。

只安装 **`harapter` 一个包**，公共 API 都从 **`harapter`**
导入。应用选择配置好的 Runtime，Harapter 在内部选择对应的协议实现，不需要为每个 Harness 再引入一个 Adapter。

[API 参考](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.zh-CN.md)

## 快速上手

使用 Node.js 24+ 和 ESM 项目。按你已经在用的 Runtime，选择下面的 **DSH**、**Pi**
或 **OpenCode** 示例。

**版本要求：**下面使用的 `run()` 和 `openSession()` 均在 `harapter@1.0.0`
之后新增。请使用包含这些 API 的后续版本或源码构建；1.0.0 发布包无法运行这些示例。

在新的应用目录中安装：

```sh
npm init -y
npm pkg set type=module
npm install harapter
```

Harapter 连接你已有的 Runtime。只需安装并登录选中的 Harness，或启动它的 HTTP 服务。任务沿用该 Runtime 的工具和权限，可能访问其工作目录并产生模型调用费用。

任选下面**一个完整示例**保存为 `app.ts`，然后运行：

```sh
node app.ts
```

### 用同一个调用接入 DSH

先确保 `PATH` 中有 `dsh`，并已配置可用的模型路由。将 `your-provider` 和
`your-model`
换成该路由的 Provider 与模型 ID；DSH 的 SDK 握手要求同时提供这两个值。Harapter 自动补齐机器接口启动参数。

<!-- sdk-example: quick-dsh-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'dsh',
    input: 'Hello!',
    model: { provider: 'your-provider', id: 'your-model' },
  });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

### Pi：沿用本地登录和模型配置

先确保 `PATH` 中有 `pi`，且已配置模型和凭据。Pi 直接沿用这些设置，无需传入
`run.model`；此入口也不接受该覆盖项。

<!-- sdk-example: quick-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({ harness: 'pi', input: 'Hello!' });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

### OpenCode：连接已有 HTTP 服务

下面连接**已经启动的 OpenCode 服务**，地址为
`http://127.0.0.1:4096`。按实际服务修改 `url`。如果服务要求认证，再通过
`headers` 传入应用从密钥存储取得的请求头；模型凭据仍由 OpenCode 管理。

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'opencode',
    url: 'http://127.0.0.1:4096',
    input: 'Hello!',
  });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

三个示例都返回同一种 `RunResult`：`status` 是最终状态，`finalMessage`
是可选回答，可交给应用的调用方或对话界面。示例只打印状态。每次 `run()`
都创建新的 Session、消费事件并清理所拥有的 Client 和 Session；返回 `failed`
与连接时抛错分别处理。

### Codex、Hermes 和 OpenClaw

保留上面的导入、结果处理和 `try/catch`，只将 `run()` 调用替换为所需的一项：

| Harness  | 替换后的调用                                          | Runtime 准备                                                   |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Codex    | `await run({ harness: 'codex', input: 'Hello!' })`    | `PATH` 中有已登录的 `codex`；Harapter 启动 App Server stdio。  |
| Hermes   | `await run({ harness: 'hermes', input: 'Hello!' })`   | 已有 `http://127.0.0.1:8642` HTTP 服务；需要时覆盖 `url`。     |
| OpenClaw | `await run({ harness: 'openclaw', input: 'Hello!' })` | `PATH` 中有已配置的 `openclaw`；Harapter 启动 `openclaw acp`。 |

Runtime 准备和兼容范围：
[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.zh-CN.md)
·
[Pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.zh-CN.md)
·
[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.zh-CN.md)
·
[Codex](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.zh-CN.md)
·
[Hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.zh-CN.md)
·
[OpenClaw](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.zh-CN.md)

完整参数、事件与 Runtime 绑定：
[API](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.zh-CN.md#run)

## 连续对话

只调用一次 `openSession()`，之后每条消息调用 `send()`。同一个 native
Session 会保留对话历史。此 API 在 1.0.0 之后新增，1.0.0 发布版尚未包含。

`openSession()` 接受上面相同的 Runtime 选项：需要时传入 DSH 的 `model`
或 OpenCode 的 `url` / `headers`，后面的 `chat.send()`
调用保持一致。已经打开的 Session 始终绑定原来的 Runtime。

<!-- sdk-example: quick-chat.ts -->

```ts
import { openSession, isHarnessError } from 'harapter';

try {
  const chat = await openSession({ harness: 'pi' });
  try {
    const first = await chat.send('My name is Alex.');
    // Return finalMessage to your application's authorized conversation UI.
    console.log({
      status: first.status,
      hasText: first.finalMessage !== undefined,
    });
    const second = await chat.send('What is my name?');
    console.log({
      status: second.status,
      hasText: second.finalMessage !== undefined,
    });
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

## 选择 Runtime 连接方式

`run()` 和 `openSession()` 共用 `RuntimeOptions`。省略 `runtime`
时使用已说明的 CLI 或 HTTP 默认连接，不需要额外导入 Harapter adapter。

嵌入式 Pi 只需安装要使用的原生 Runtime（`npm install @earendil-works/pi-coding-agent@0.85.1`），然后提供其工厂。宿主控制凭据、模型、工具、资源发现和共享 ModelRuntime。每次工厂调用必须返回一个新的、空闲的 Session，并将其独占所有权交给 Harapter。关闭对话只释放该 Session，不释放宿主共享 Runtime。

```ts
import { openSession, isHarnessError } from 'harapter';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

try {
  const chat = await openSession({
    harness: 'pi',
    runtime: {
      kind: 'pi-sdk',
      version: '0.85.1',
      createSession: async () => (await createAgentSession()).session,
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

已有 DSH Gateway 时，直接连接宿主已认证的服务。`protocol`、`storeId` 和
`exclusiveSessions` 是宿主必须明确提供的协议、存储和独占使用承诺；Cookie
resolver 只保留在内存中。Harapter 不启动服务或交换 launch
token。此绑定不能混用 process/model/workspace/header 覆盖项；请在 Runtime 中配置，或使用其原生控制。

```ts
import { openSession, DSH_GATEWAY_PROTOCOL, isHarnessError } from 'harapter';

try {
  const chat = await openSession({
    harness: 'dsh',
    runtime: {
      kind: 'dsh-gateway',
      url: 'http://127.0.0.1:9345',
      protocol: DSH_GATEWAY_PROTOCOL,
      storeId: 'my-dsh-store',
      exclusiveSessions: true,
      resolveCookie: () => process.env.DSH_GATEWAY_COOKIE ?? '',
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

OpenCode 和 Hermes 使用 HTTP/SSE，不依赖 Harapter 管理的 SDK 子进程；Codex 使用 App
Server stdio。OpenClaw 仍通过 ACP 运行任务，可配置
`runtime: { kind: "openclaw-acp", gateway }`，传入已有的
`OpenClawGatewayBinding`
并保留其 profileId。此 Gateway 只补充已支持的原生 Session 控制，Harapter 不负责关闭它。

一个对话同时只允许一个活动 Run。`send()` 消费事件，支持
`{ timeoutMs, onEvent }`；默认期限沿用 `openSession()`
的值（未设置时为 60000 毫秒）。观察回调、超时或交互处理失败会关闭所拥有的连接，这不等于已证明原生取消。需要交互时使用继承的
`start()` / `respond()`；支持取消时调用返回 Run 的 `cancel()`。`chat.client`
暴露同一连接的能力、扩展、恢复和原生控制。关闭 chat 也会关闭这个 Client；需要独立管理或恢复 Session 时继续使用 Client/Session
API。

## 在应用中接收事件

界面或 Worker 需要进度时传入
`onEvent`。回调可以是异步函数，Harapter 会等待它完成。事件外层结构统一，载荷仍遵循对应 Adapter 的文档。私有事件数据应留在应用内部。

```ts
import { run } from 'harapter';

const result = await run({
  harness: 'pi',
  input: 'Hello!',
  onEvent(event) {
    console.log({ type: event.type });
  },
});
```

## 结果、超时与会话

每次 `run()` 都创建新的 Session，返回权威的 `RunResult`，包括
`failed`、`cancelled` 或
`connection_aborted`。返回结果不一定代表成功。连接、事件回调或清理失败会抛出安全的
`HarnessError`；用 `isHarnessError` 判断后读取 `error.code`。

整次调用默认限时 60 秒，可以通过 `timeoutMs` 修改。到期会抛出 `timeout`
并关闭持有的连接；这不代表原生取消成功，远端任务可能继续。清理可能超过截止时间，迟到的连接或 Session 句柄会在返回后被关闭。

`run()` 不代答审批或用户输入：遇到 `interaction.requested` 会抛出
`unsupported_capability`。交互、恢复、分叉、原生取消和自定义连接策略使用 Client/Session 控制；普通多轮对话和 DSH
Gateway 连接可使用上面的
`openSession()`。关闭句柄不会删除原生历史，也不会停止外部服务。

[完整参数类型、默认命令、服务地址和模型限制](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.zh-CN.md#run)

## 进阶：应用管理连接 Profile

需要显式管理 Session 时，可以一起复制 `quick-start.ts` 和
`runtime-config.ts`，或改用可复用的 `runTask`
服务示例。这些是单次调用之外的进阶用法，不是 `run()` 的前置步骤。

[quick-start.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-start.ts)
·
[runtime-config.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/runtime-config.ts)
·
[runTask](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-unified.ts)

## 公共 API 与配置

方法、参数、返回值与错误码可直接查阅
[API 参考](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.zh-CN.md)。

使用内置 Harness 时，公共 API 统一从 `harapter`
导入。切换连接 Profile 无需导入 Provider 子路径，也无需手动注册 Adapter
Factory。

- `createHarapter(options?)` 返回
  `Promise<HarnessRegistry>`。在应用组装时等待一次，然后通过 `connect(profile)`
  连接选中的 Runtime。创建 Registry 不启动进程或连接。
- `HarapterOptions.harnesses`
  显式选择内置实现；重复项只加载一次。省略整个参数会返回空的可扩展 Registry；传入配置对象时必须提供
  `harnesses` 数组。
- `resolveAuthHeaders(ref)` 为 OpenCode 和 Hermes 提供宿主持有的 HTTP 请求头；
  `resolveGatewayCookie(ref, signal)` 提供 DSH Gateway
  Cookie。仅在对应 Adapter 需要鉴权时调用。宿主根据准确的 Secret 引用判断权限。
- 重新导出所有
  [Core 公共接口](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.zh-CN.md)，包括 Profile、输入、事件、最终结果、能力、错误和扩展。入口不导出 Adapter 命名空间或第三方 Runtime
  API。

| 选择名称   | Profile `providerId` | Runtime 连接与兼容范围说明                                                                                   |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `codex`    | `openai.codex`       | [Codex app-server](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.zh-CN.md)          |
| `dsh`      | `deepseek.harness`   | [DSH SDK 进程或 Gateway 端点](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.zh-CN.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP 服务](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.zh-CN.md)         |
| `openclaw` | `openclaw`           | [OpenClaw ACP 进程](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.zh-CN.md)      |
| `opencode` | `opencode`           | [OpenCode HTTP 服务](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.zh-CN.md)     |
| `pi`       | `pi.agent`           | [Pi JSONL 进程](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.zh-CN.md)                |

Profile 通过 `connection`、`providerOptions` 和可选 `requiredCapabilities`
选择已有机器接口，不会从任意 Runtime 对象自动推断协议。每个内置实现仍以其文档中的兼容范围和能力证据为准。

## 生命周期、错误与原生接入

返回的 Registry 就是现有 Core
Registry：隔离 Profile 快照，校验连接类型和能力要求，并把 Session 绑定到创建它的 Provider、Profile 和原生状态。切换 Harness 后创建新 Session。注册不会让检查点可迁移，也不会新增原生分叉、取消能力或替换 Runtime 的工具与权限策略。

持续消费 `run.events()`，以 `run.result()`
为最终状态依据。事件类型和外层结构统一， `event.data`
仍遵循对应 Adapter 的映射；不能假定所有 Payload 都是同一种文本增量或工具结构。超出公共生命周期的操作由能力声明和类型化扩展描述。私有内容和 Session 引用由宿主授权存储保管，不进入通用日志。

非法 Harness 选择返回 `invalid_request`；内置实现无法初始化返回脱敏后的
`provider_api_incompatible`。修复配置或安装前，两者均不应直接重试。未注册的 Profile 返回
`provider_not_found`；连接、鉴权、生命周期错误沿用 Core 分类。

自定义 Adapter 使用 `registry.register(factory)`
注册。OpenClaw 宿主 Gateway 绑定等原生组装需求，从 `harapter/openclaw`
显式导入 Factory，而不选择默认内置项。这些都是同一个 SDK 的子路径，Core 和原生扩展契约保持一致。

## 验证与包链接

[Runtime Profile 示例](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/README.zh-CN.md)
通过 DSH 进程和带鉴权的 OpenCode HTTP
Fixture 验证共同任务代码、终态事件、Session 归属和清理行为。发布检查在隔离项目中只安装
`harapter`
Tarball，编译示例并运行两个 Fixture，确认没有安装任何独立 Adapter 包。这是确定性集成证据，不是新的真实 Runtime 验证。

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.zh-CN.md)
·
[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.zh-CN.md)

## 包中包含什么

SDK 包含 Core 和全部受维护的第一方协议映射，唯一的运行时依赖是
`ws`。选择 Harness 控制动态加载范围，不改变 Tarball 下载大小。上游 Harness
SDK 和 Runtime 发行包不是 `harapter` 的依赖。

源码仓库中的 `packages/core`、`packages/transport-*`、`packages/conformance` 和
`providers/*`
保留为私有工作区模块。它们的实现和测试用于构建唯一的公开包，不是用户还要另外安装的 npm 包。各目录职责见[源码目录说明](https://github.com/yunfeizhu/harapter/blob/main/packages/README.md)。

通过 `harapter/testing` 使用 Fake Provider 不需要 Vitest。只有使用可选的
`harapter/conformance` 测试套件时，才需要另装 Vitest。

## 公开子路径

以下入口都属于同一个已安装的包。普通应用使用根入口；原生能力接入、自定义 Adapter 和测试可以使用明确的子路径。

| Import                              | Guide                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `harapter`                          | [core](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.zh-CN.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonrpc-stdio/README.zh-CN.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonl-process/README.zh-CN.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-http-sse/README.zh-CN.md)           |
| `harapter/transports/acp`           | [transport-acp](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-acp/README.zh-CN.md)                     |
| `harapter/conformance`              | [conformance](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.zh-CN.md)                         |
| `harapter/codex`                    | [adapter-codex](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.zh-CN.md)                            |
| `harapter/dsh`                      | [adapter-dsh](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.zh-CN.md)                                |
| `harapter/hermes`                   | [adapter-hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.zh-CN.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.zh-CN.md)                      |
| `harapter/opencode`                 | [adapter-opencode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.zh-CN.md)                      |
| `harapter/pi`                       | [adapter-pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.zh-CN.md)                                  |
| `harapter/testing`                  | [Fake Provider](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.zh-CN.md)                       |

## 从独立包迁移

将 `@harapter/*` 依赖替换为 `harapter`。内置 Harness 的应用接入使用
`createHarapter({ harnesses: [...] })`，公共类型从 `harapter`
导入，不必再逐个导入、注册 Adapter
Factory。已有 Session 的归属与原生兼容性要求仍然适用。

自定义 Adapter、原生扩展和底层测试可使用上面的子路径。旧包名不是兼容别名，应用依赖与导入需要一起更新。
