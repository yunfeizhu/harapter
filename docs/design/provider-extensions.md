# Provider 特有能力

## 1. 设计目标

不同 Harness 的设计重点、状态模型和扩展体系天然不同。Adapter 不应为了制造表面一致而删除它们的独有能力。

正确的覆盖保证是：

> 公共能力可以移植，Provider 特有能力可以访问，官方可编程能力不会因统一层而丢失。

它不保证所有功能都能通过 Portable
Core 调用，也不保证所有图形界面功能都有机器接口。

## 2. 三层调用模型

### 2.1 Portable Core

Portable Core 面向需要选择或切换 Harness 的业务代码：

```ts
const session = await client.createSession();
const run = await session.start(input);

for await (const event of run.events()) {
  render(event);
}
```

这类代码不依赖 Provider 名称和原生类型，可以在 Qwen、OpenCode、Codex 等 Provider 之间复用。

### 2.2 Optional Capability

Optional
Capability 适合多个 Provider 具有相近语义、但不是所有 Provider 都支持的能力：

```ts
const support = capabilities.capabilities['session.resume'];

if (support.mode === 'native') {
  await client.resumeSession(ref);
}
```

只有经过至少两个独立 Provider 的真实映射验证，并且不会删除关键语义的行为，才适合进入公共 Capability 命名空间。

### 2.3 Provider Extension

Provider 独有功能进入 Provider 命名空间：

```ts
const recipes = client.extensions().get<GooseRecipes>('goose.recipes');
const goals = client.extensions().get<QwenGoals>('qwen.code.goal');
const apps = client.extensions().get<CodexApps>('openai.codex.apps');
```

使用这些接口的代码明确与对应 Provider 绑定，不宣称可以无修改切换 Harness。

## 3. Extension Registry

```ts
interface ProviderExtensionRegistry {
  list(): ProviderExtensionDescriptor[];
  has(name: string): boolean;
  get<T>(name: string): T | undefined;
}

interface ProviderExtensionDescriptor {
  name: string;
  providerId: string;
  displayName: string;
  description?: string;
  documentationUrl?: string;
  stability?: 'stable' | 'experimental';
}
```

Core 不维护 Extension 枚举，也不根据名称执行 Provider 逻辑。宿主 UI 可以为已知 Extension 提供专用界面，但未知 Extension 仍应能通过 Descriptor 和 Provider 自带 UI/API 使用。

## 4. Native Escape Hatch

Provider Adapter 应暴露官方 SDK Client 或等价的公开协议客户端：

```ts
const native = client.native<OfficialProviderClient>();
```

Native Escape Hatch 解决两类问题：

- 官方接口已经支持某项能力，但 Adapter 尚未提供类型化 Extension；
- 高级调用方需要官方对象、方法、事件或协议字段。

Native
Client 不经过 Core 语义转换。参数、错误、认证和稳定性遵循 Provider 官方接口，使用它的代码自行承担 Provider 绑定和版本兼容责任。

## 5. Raw Event

Provider 出现 Adapter 尚未认识的事件时，至少保留：

```ts
{
  type: 'provider',
  providerEventType: nativeEvent.type,
  raw: redact(nativeEvent),
}
```

Raw
Event 默认关闭，并受大小、速率和脱敏限制。它用于诊断和高级功能，不是让宿主绕过公共事件模型读取所有私有推理或敏感 Tool 结果。

## 6. 插件市场与扩展生态

Harness 自己的插件市场、Recipe、Package、App 或 Skill 系统仍由 Harness 拥有。Provider
Adapter 只在官方机器接口允许时提供控制面。

以 DeepSeek Harness 插件市场为例：

```ts
interface DshPluginMarketplace {
  search(query: string): Promise<DshPluginCandidate[]>;
  listInstalled(): Promise<DshInstalledPlugin[]>;
  install(request: DshInstallPluginRequest): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  remove(pluginId: string): Promise<void>;
}
```

该接口必须直接调用 DSH 官方 API。Adapter
Core 不自行执行 npm 安装、不直接修改 DSH Profile，也不复制 Cordis 生命周期。

如果插件市场只存在于 Provider
UI，没有公开机器接口，Adapter 不宣称支持管理功能。已经由用户在 Runtime 中配置好的插件仍可正常影响任务执行。

## 7. 常见 Provider Extension

| Provider           | Extension 示例                             | 归属原因                                           |
| ------------------ | ------------------------------------------ | -------------------------------------------------- |
| DeepSeek Harness   | `deepseek.harness.plugins.marketplace`     | Cordis 插件和 Profile 是 DSH 原生体系              |
| Goose              | `goose.recipes`、`goose.extensions`        | Recipe 和 Extension 生命周期由 Goose 定义          |
| Qwen Code          | `qwen.code.goal`、`qwen.code.subagents`    | Goal 和自定义 Subagent 不是所有 Harness 的共同语义 |
| Codex Harness      | `openai.codex.apps`、`openai.codex.skills` | App 和 Skill 由 Codex App Server 定义              |
| GitHub Copilot CLI | `github.copilot.commands`                  | 可用 Slash Command 由 ACP Server 动态发布          |
| Crush              | `charm.crush.lsp`、`charm.crush.mcp`       | LSP、MCP 和共享 Workspace 属于 Crush 服务模型      |
| OpenCode           | `opencode.commands`、`opencode.plugins`    | Command 和 Plugin 保留 OpenCode 原生结构           |
| Cursor Agent CLI   | `cursor.rules`、`cursor.mcp`               | Rules 和 MCP 配置遵循 Cursor 自己的目录和权限模型  |

这些名称是设计命名空间，实际 Extension 只有在 Provider
Adapter 实现并通过测试后才能发布。

## 8. 能力提升规则

Provider 特有能力只有同时满足以下条件时，才适合提升为公共 Optional Capability：

- 至少两个独立 Harness 提供公开机器接口；
- 生命周期、输入、输出和错误具有可解释的共同语义；
- 公共接口不会删除任一 Provider 的关键行为；
- 不支持该能力的 Provider 可以明确拒绝，不需要伪造实现；
- 原生接口仍可通过 Extension 或 Native Client 访问；
- Conformance Test 能验证共同语义，而不仅是方法名称相似。

否则继续保留为 Provider Extension。

## 9. 可移植性

| 使用层级            | 功能覆盖                   | 跨 Provider 可移植性 |
| ------------------- | -------------------------- | -------------------- |
| Portable Core       | 公共最低语义               | 高                   |
| Optional Capability | 部分 Provider 的共同能力   | 条件可移植           |
| Provider Extension  | 已适配的 Provider 独有能力 | 不可移植             |
| Native Client       | 官方 SDK/API 可访问能力    | 不可移植             |

宿主应在模块边界上明确选择哪一层，不能把 Provider
Extension 隐藏在声称完全可移植的业务接口中。

## 10. 无法覆盖的功能

以下功能不能被正式 Adapter 可靠覆盖：

- 只有图形界面或交互式终端才能操作的功能；
- 没有公开 SDK、RPC、HTTP API 或稳定机器协议的功能；
- 依赖解析 TUI 文本、点击 UI 或调用非公开内部函数的功能；
- 官方接口明确禁止外部调用的功能；
- 需要复制 Provider 内部 Agent Loop 才能实现的功能。

当官方接入面不足时，Provider
Adapter 必须在 Capability 和文档中说明限制，不能用脆弱模拟替代正式支持。
