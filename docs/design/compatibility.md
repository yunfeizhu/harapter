# 兼容性设计

## 1. 基本判断

Core 应当与具体 Harness 版本无关，但 Provider Adapter 不能完全不关心版本。

Adapter 调用的是第三方 SDK/API。只要方法、字段、事件、错误或生命周期可能改变，映射层就必须能识别当前接口是否仍然兼容。忽略版本不会消除破坏性变化，只会把它推迟到用户任务执行时，以空事件、错误映射或状态丢失的形式出现。

正确边界是：

- Core 不知道 Qwen、Codex、DSH 等具体版本；
- 每个 Provider Adapter 独立处理自己的协议兼容性；
- 宿主可以选择使用最新版 Runtime，但不能把“最新版”自动等同于“已验证兼容”；
- 接口兼容依据以握手、Schema 和行为探测为主，版本号只是证据之一。

## 2. 三种版本

需要区分：

| 对象             | 版本职责                            |
| ---------------- | ----------------------------------- |
| Core             | 稳定公共契约和 Provider Adapter SPI |
| Provider Adapter | 目标 Harness 接口映射和兼容策略     |
| Harness Runtime  | 实际 SDK、CLI、服务或协议实现       |

三者可以独立发布。更新 Qwen Code
Adapter 不应要求发布新的 Core；修复 Cursor 事件解析也不应影响 OpenCode Adapter。

## 3. 建连时兼容探测

`connect()` 在创建用户 Session 前完成接口允许的无副作用或低副作用验证：

1. 确认 Runtime 或 Endpoint 存在；
2. 读取公开的协议兼容承诺、握手信息和可用的运行时 Schema；
3. 选择已具备 Fixture 和 Conformance 证据的兼容性策略；
4. 在握手阶段校验可探测的必需结构；
5. 生成 Client Descriptor 和 Capability Manifest；
6. 对已知不兼容接口返回 `provider_api_incompatible`。

无法通过握手枚举的响应和事件结构在对应操作首次出现时做结构校验。缺失必需字段返回
`provider_api_incompatible`；新增可选字段按上游公开的前向兼容规则处理。不能通过执行真实用户任务来探测 Capability。无法安全判断时，应标记
`experimental`、`unknown` 或失败关闭。

## 4. Schema 优先

如果 Provider 能生成或发布机器可读 Schema，应优先使用它：

- Codex App Server 按当前 Runtime 生成 TypeScript 或 JSON
  Schema，用于 Fixture、Mapping 和 Conformance 证据；
- OpenCode 提供 OpenAPI；
- ACP Provider 遵循 ACP 基础协议，同时探测 Provider 通知和扩展；
- JSONL CLI 使用公开 Event Schema 和 Recorded Fixture；
- SDK Provider 使用官方导出类型和最小运行时特征探测。

版本范围只能说明“可能兼容”。官方稳定协议承诺、当前 Schema、操作时结构校验和 Conformance 共同界定 Adapter 支持的接口。

## 5. Compatibility Strategy

Provider 包内部可以为不同协议族保留独立策略：

```text
adapter-qwen
    ├── strategy-sdk
    ├── strategy-acp
    ├── strategy-daemon
    └── strategy-stream-json

adapter-opencode
    ├── strategy-http-openapi
    └── strategy-acp
```

不同 Strategy 共享公共 Provider 语义测试，但可以产生不同 Capability。Strategy 是 Provider 包内部实现，不进入 Core 枚举。

当上游发生破坏性变化时，通常只需要：

1. 保留仍被用户使用的旧 Strategy；
2. 新增或替换新协议 Strategy；
3. 更新 Event、Error 和 Capability 映射；
4. 增加新旧 Fixture 与 Live Conformance；
5. 发布该 Provider Adapter；
6. 不修改 Core 和其他 Provider 包。

这使替换速度足够快，但不能保证任何未知未来变化都无需代码修改。

## 6. 是否必须锁定 Runtime 版本

Adapter 设计不要求用户永远固定某个 Harness 版本，但生产部署需要可复现性。

推荐支持三种宿主策略：

### 6.1 Verified

只运行 Adapter CI 已验证的 Runtime 版本或协议指纹。适合企业和稳定客户端。

### 6.2 Compatible Range

允许符合已知 Schema 和行为探测的版本范围。适合日常桌面产品。

### 6.3 Latest Canary

允许用户跟随最新 Runtime，但首次连接必须重新探测并明确展示实验状态。适合开发者预览，不应自动扩大稳定支持声明。

因此，类似 `adapter-dsh 0.4.1` 的 Adapter 包版本不是要求 Harness
Runtime 永久锁死在同一个版本。更合理的是让 Adapter 声明和探测它能理解的协议族，并由宿主决定部署是否固定 Runtime。

## 7. Capability 是运行时结果

Capability 不能只写在静态表中。它至少受到以下因素影响：

- Runtime 版本和协议；
- Connection Strategy；
- 启动参数；
- 账号和许可；
- 已启用的插件、Skill、App 或 MCP；
- 服务端功能开关；
- 操作系统和部署方式。

同一个 `github.copilot-cli`
Provider 使用不同 Server 启动参数时，Capability 可能不同；同一个 OpenCode
Provider 使用 HTTP 和 ACP 时也可能不同。

Capability 缓存必须以 Runtime
Identity 和关键非敏感配置摘要为键，不能只以 Provider ID 为键。

Capability 结果必须区分 `native`、有证据的 `emulated`、
`adapter_controlled`、`unsupported` 和
`unknown`。Manifest 缺少某个名称表示当前 Adapter 不认识该能力，而显式 `unknown`
表示认识名称但证据不足；两者都不能默认通过只接受 `native` 的宿主要求。

## 8. Runtime Identity

诊断和兼容缓存可以使用以下非敏感身份：

```text
Runtime Identity =
  Provider ID
  + Adapter Version
  + Connection Strategy
  + Runtime Version or Protocol Fingerprint
  + Extension/Profile Fingerprint when relevant
```

Identity 不保存 Secret、完整环境变量、用户 Prompt、文件正文或本地凭据路径。

对于插件化 Harness，插件集合可能改变事件、Tool 和 Agent 行为。Provider 能读取扩展指纹时，应将它纳入 Capability 缓存和 Session
Compatibility Ref；不能读取时必须在限制文档中说明。

## 9. 未知字段与未知事件

- 文档明确允许新增字段时，Adapter 应忽略不认识的可选字段；
- 缺失必需字段时返回协议不兼容，不能填入误导性默认值；
- 未知 Event 保留为 `provider` Event；
- 未知终态不能推断为成功；
- CLI 非零退出且缺少终止 JSON 时映射为 `run.failed` 或 `connection.aborted`；
- Provider 原始错误必须脱敏、限长并保留原始错误码。

## 10. 回滚与并存

Provider Adapter 包应允许兼容 Strategy 并存。宿主升级失败时，可以：

- 回滚单个 Provider Adapter；
- 切换到旧 Strategy；
- 继续使用旧 Runtime；
- 将新 Runtime Profile 标记不可用，而不影响其他 Provider；
- 为新任务选择另一个 Harness Profile。

已创建 Session 仍受原 Provider 和兼容性身份约束。回滚不能让另一个 Provider 接管该 Session，也不能保证新 Runtime 能恢复旧 Checkpoint。

## 11. 支持声明

每个 Provider 发布物必须说明：

- 支持的 Connection Strategy；
- 已验证的 Runtime 或协议范围；
- 必需和可选 Capability；
- 已知不兼容版本或特征；
- Authentication 和 Runtime 安装前提；
- Experimental 能力；
- Fixture 和 Live Conformance 覆盖范围；
- Provider Extension 和 Native Client 稳定边界。

静态文档用于解释范围，运行时 Capability
Manifest 用于决定当前连接能做什么。二者都不能由品牌名替代。

## 12. 兼容性测试

每个 Provider 至少覆盖：

- 最低已支持接口；
- 当前主流接口；
- 未知新增字段；
- 必需字段删除或重命名；
- Event 类型新增和终态改变；
- 错误结构改变；
- 连接中断和进程异常退出；
- Capability 与实际行为一致；
- 旧 SessionRef 在兼容与不兼容 Runtime 上的恢复结果；
- Provider Extension 不影响 Portable Core；
- Secret 和敏感原始信息不会进入 Fixture、日志和错误。

最新上游可以进入定时 Canary 测试，但 Canary 通过之前不能自动扩大稳定兼容范围。
