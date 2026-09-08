# 在真实应用中使用 Harapter

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

从你自己的 Node.js
24+／TypeScript 项目和 npm 包开始。本目录是完整的私有示例应用，不是需要额外安装的 npm 包。依赖使用已发布版本，TypeScript 配置不依赖 Harapter 仓库。

## 创建并运行项目

单文件入门请看[根 README 快速上手](../../README.zh-CN.md#快速上手)。需要按业务模块组织时，将本目录复制到自己的项目中，或保存下面列出的文件，然后在这个独立目录执行：

```sh
npm install
npm run build
npm run offline
```

## 准备 Runtime

按 Codex 的[官方说明](https://developers.openai.com/codex/cli/)安装并认证。先运行一次
`codex`
完成登录，再启动应用。创建一个空测试工作区，并在运行应用的终端设置以下变量；Windows 用户在 PowerShell 中设置同名变量。Harapter 只启动你配置的进程，不负责安装或登录。

```sh
mkdir -p /tmp/harapter-example-workspace
export HARAPTER_CODEX_COMMAND=codex
export HARAPTER_WORKSPACE=/tmp/harapter-example-workspace
npm start
```

预期先输出事件类型，再输出
`{"status":"completed","hasText":true}`。模型可能失败或不返回文本，程序会保留实际结果。Ctrl+C 请求原生取消，未完成的结果使进程以失败状态退出。`npm run offline`
不需要 Runtime 或模型凭证，输出 `offline application passed`。

## 项目文件

| 文件                                       | 用途                                   |
| ------------------------------------------ | -------------------------------------- |
| [package.json](package.json)               | npm 依赖与运行命令                     |
| [tsconfig.json](tsconfig.json)             | 独立严格 ESM 构建                      |
| [src/main.ts](src/main.ts)                 | 真实 Codex 调用、SIGINT 与安全状态输出 |
| [src/service.ts](src/service.ts)           | 业务调用、恢复、超时与结果             |
| [src/interactions.ts](src/interactions.ts) | 异步宿主交互观察器                     |
| [src/codex.ts](src/codex.ts)               | Codex 连接与只读 Session 配置          |
| [src/endpoints.ts](src/endpoints.ts)       | HTTP 与 DSH Gateway 组合               |
| [src/processes.ts](src/processes.ts)       | DSH SDK、OpenClaw、Pi 组合             |
| [src/recipes.ts](src/recipes.ts)           | 恢复、Codex 原生分叉、多 Provider 并发 |
| [src/approval.ts](src/approval.ts)         | 显式终端审批处理                       |
| [src/offline.ts](src/offline.ts)           | 离线应用检查                           |

## 接入业务模块

从应用本地的 service 模块导入 `runTask`，传入经过身份验证的用户输入，把
`result.finalMessage`
返回给该用户的受控界面。SDK 应运行在 Node.js 服务端或桌面主进程，不直接运行在不受信任的浏览器里。调用方在
`finally`
中关闭 Client；任务异常也会关闭该 Client 并保留原始错误，之后不要复用这个连接。

```ts
import { connectCodex } from './codex.js';
import { runTask } from './service.js';

export async function answerUser(
  text: string,
  command: string,
  workspace: string,
) {
  const { client, session } = await connectCodex(command, workspace);
  try {
    const { result } = await runTask(client, text, { session });
    return { status: result.status, text: result.finalMessage };
  } finally {
    await client.close();
  }
}
```

## 结果、状态和取消

持续消费事件；`result.finalMessage` 是可选的最终文本，`result.status`
是最终状态依据。各 Adapter 的事件 payload 不等同于统一的文本增量格式，使用
`event.data`
前请查看对应映射。示例终端只输出事件类型和状态，返回给业务层的文本并没有被丢弃。不要把完整 Result 序列化到通用日志。

将返回的 Session 引用保存在有访问控制的业务存储中，按已认证用户和原 Provider/Profile 索引。引用包含私有原生状态；恢复还需要保留原生存储、兼容 Runtime、Session 能力支持及相同 Profile 配置。保存 JSON 不等于跨 Provider 迁移。本示例在内存中保留引用，持久化与多租户授权由宿主应用负责。

显式用户取消通过 AbortSignal 传入。示例服务要求该 Session 已观测到原生取消能力，不满足时在启动前明确失败。超时属于另一项 Run 截止时间控制，可能按 Adapter 语义产生
`failed` 或
`connection_aborted`。始终检查最终结果，不把连接关闭当成原生取消成功。

## 场景案例

| 场景                  | 入口                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| 单次调用与流式消费    | `runTask(client, text, { onEvent })` → `result.finalMessage`           |
| 重连后恢复            | `runTask(client, text, { resume: savedRef })`                          |
| 分叉并继续            | `forkCodexConversation(client, savedRef, text)`                        |
| 取消与超时            | `runTask(client, text, { signal, timeoutMs: 60_000 })`                 |
| 并发调用多个 Provider | `runAcrossProviders(first, second, text)`                              |
| 审批交互              | `runTask(client, text, { onInteraction: terminalApproval(describe) })` |

## 运行完整案例

执行 `npm run build` 后，每条命令都有完整入口：

| 命令               | 执行内容                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| `npm start`        | 一次真实 Codex 调用并消费事件；Ctrl+C 请求原生取消。                          |
| `npm run sessions` | 三次真实 Codex 调用：创建、关闭并重连恢复、原生分叉并继续。                   |
| `npm run multi`    | 并发调用 Codex 和 OpenCode，分别处理成功或失败结果。                          |
| `npm run cancel`   | 离线 Fake 的取消与超时，输出 `cancelled` 和 `connection_aborted`。            |
| `npm run approval` | 在 TTY 中处理离线 Fake 审批，输入完整的 `approve` 或 `deny`；不执行真实命令。 |

会话案例使用与 `npm start`
相同的 Codex 配置，保留原生会话数据（`ephemeral: false`），仅在内存中保存私有引用，三次调用可能产生模型费用。多 Provider 案例还需配置
`HARAPTER_OPENCODE_URL`、`HARAPTER_OPENCODE_WORKSPACE`
（服务端已存在的绝对目录）、`OPENCODE_SERVER_PASSWORD`，以及可选的
`OPENCODE_SERVER_USERNAME`（默认 `opencode`）。请按
[OpenCode 指南](../../providers/opencode/README.zh-CN.md)准备已认证且禁用工具的服务。应用关闭自己的连接，外部服务继续运行。

完整源码：[session-main.ts](src/session-main.ts)、[multi-main.ts](src/multi-main.ts)、
[cancel-demo.ts](src/cancel-demo.ts)、[approval-demo.ts](src/approval-demo.ts)。Fake 审批只包含已知的虚构动作；接入真实审批时，用宿主对当前请求的核验替换固定说明。Fake 收到拒绝后仍会完成回显 Run，拒绝动作不等于取消 Run。

## 审批界面

只有宿主能为当前请求提供已核对且适合展示的动作说明时，`terminalApproval`
才打开 TTY。无法确认说明时拒绝动作，不支持的交互类型明确失败。不能仅凭通用标题或脱敏 schema 批准命令。请求解决、超时或 Run 终止后，回调信号会关闭界面。这个终端只处理可移植审批；Pi 需要其原生
`select`／`confirm`／`input`／`editor`
响应，DSH 当前没有宿主响应路径。默认 Codex 配置为只读且禁用审批；需要测试审批时，必须显式选择经过宿主审查的权限策略。

## 选择其他 Provider

六个 `quick-*.ts`
都是仅使用公开 SDK 导入的独立单文件入口，完整配置步骤见各 Adapter
README。`endpoints.ts` 和 `processes.ts`
提供业务组合函数，调用连接函数前不会启动 Runtime。DSH
Gateway 使用单独的端点组合；稳定存储身份和独占 Session 声明必须符合实际部署。OpenClaw 历史操作需要其 Adapter 文档所述的额外宿主 Gateway 绑定。

- [codex](../../providers/codex/README.zh-CN.md):
  [quick-codex.ts](src/quick-codex.ts)
- [opencode](../../providers/opencode/README.zh-CN.md):
  [quick-opencode.ts](src/quick-opencode.ts)
- [dsh](../../providers/dsh/README.zh-CN.md): [quick-dsh.ts](src/quick-dsh.ts)
- [hermes](../../providers/hermes/README.zh-CN.md):
  [quick-hermes.ts](src/quick-hermes.ts)
- [openclaw](../../providers/openclaw/README.zh-CN.md):
  [quick-openclaw.ts](src/quick-openclaw.ts)
- [pi](../../providers/pi/README.zh-CN.md): [quick-pi.ts](src/quick-pi.ts)

## 验证范围

应用会在 Workspace 外通过 npm 包编译并运行；仓库检查还会使用新打包的发布产物验证。离线测试证明应用行为，不替代真实 Provider 兼容性证据；对应边界由[官方 Runtime 证据](../../docs/provider-interaction-evidence.md)维护。真实入口使用已有认证，可能消耗 token 并创建原生 Session 数据。请使用空测试工作区及 Runtime 自身的工具／沙箱策略。关闭 Client 不会停止外部 HTTP 服务或 Gateway。

2026-09-08，仓库外的 npm 应用使用 Harapter 0.3.0 和官方 Codex CLI
0.153.4，实际执行了 `quick-codex`、`main` 与
`session-main`，五次真实 Runtime 调用全部完成，包含重连恢复和原生分叉。模型请求由隔离的本地回环合成服务响应，没有工具调用，没有使用模型凭证。这证明应用接入路径，不代表所有 Provider 的新增兼容性声明，也不等于付费模型 canary。

## 仓库贡献者入口

只有参与仓库开发时才需要完整 Workspace，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm --filter harapter-sdk-application build
pnpm --filter harapter-sdk-application offline
```
