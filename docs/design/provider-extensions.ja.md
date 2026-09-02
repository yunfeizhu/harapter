[English](./provider-extensions.md) · [简体中文](./provider-extensions.zh-CN.md)
· [日本語](./provider-extensions.ja.md)

# Provider 固有 Capability

## 1. 設計目標

Harness ごとに設計の重点、State Model、Extension
System は本来異なります。Adapter は表面上の統一感を作るために、それらの固有 Capability を削除すべきではありません。

正しい Coverage 保証は次のとおりです。

> Portable
> Capability は移植可能なまま、Provider 固有 Capability はアクセス可能なままであり、統一層が公式のプログラム可能な動作を失わないこと。

Portable Core からすべての Feature を呼び出せることや、すべての GUI
Feature に Machine Interface があることは保証しません。

## 2. 3 層の呼び出しモデル

### 2.1 Portable Core

Portable Core は、Harness を選択または切り替える必要がある Application
Code に使用します。

```ts
const session = await client.createSession();
const run = await session.start(input);

for await (const event of run.events()) {
  render(event);
}
```

この種の Code は Provider 名や Native
Type に依存せず、Qwen、OpenCode、Codex などの Provider 間で再利用できます。

### 2.2 Optional Capability

Optional
Capability は、複数 Provider で類似する Semantics を持つものの、すべての Provider がサポートするわけではない動作に適します。

```ts
if (capabilities.capabilities['session.resume']?.mode === 'native') {
  await client.resumeSession(ref);
}
```

少なくとも 2 つの独立 Provider の実 Mapping が証明し、共通 Contract が重要な Semantics を失わない動作だけを、Public
Capability Namespace に追加します。

### 2.3 Provider Extension

Provider 固有動作は Provider Namespace に入ります。

```ts
const recipes = client.extensions().get<GooseRecipes>('goose.recipes');
const goals = client.extensions().get<QwenGoals>('qwen.code.goal');
const apps = client.extensions().get<CodexApps>('openai.codex.apps');
```

これらの Interface を使用する Code は対応 Provider に明示的に結び付き、変更なしで Harness を切り替えられるとは表明しません。

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

Core は Extension Enum を管理せず、Extension 名に基づく Provider
Logic を実行しません。Host
UI は既知 Extension に専用 Interface を提供できますが、未知 Extension も Descriptor と Provider が所有する UI/API を通じてアクセス可能です。

## 4. Native Escape Hatch

Provider Adapter は、公式 SDK Client または同等の公開 Protocol
Client を公開すべきです。

```ts
const native = client.native<OfficialProviderClient>();
```

Native Escape Hatch は次の 2 つのケースを扱います。

- 公式 Interface はある動作をサポートしているが、Adapter がまだ Typed
  Extension を提供していない
- Advanced Caller が公式 Object、Method、Event、Protocol Field を必要とする

Native Client は Core
Semantics 変換を受けません。Parameter、Error、Authentication、Stability は公式 Provider
Interface に従います。それを使用する Code は Provider Binding と Version
Compatibility を自ら担います。

## 5. Raw Event

Provider が Adapter の未知 Event を送った場合、対応する HarnessEvent
Mapping は少なくとも次の断片を含みます。

```ts
{
  type: 'provider',
  providerEventType: nativeEvent.type,
  data: boundedSummary(nativeEvent),
  ...(rawChannel.enabled
    ? { raw: redactAndBound(nativeEvent, rawChannel.limits) }
    : {}),
}
```

Raw
Event は既定で無効です。有効にしても、サイズと Rate に上限を設け、Redaction を適用します。Diagnostic と Advanced
Feature のためのものであり、Host が Portable Event
Model を迂回してすべての Private Reasoning や Sensitive Tool
Result を読むためのものではありません。

## 6. Plugin Marketplace と Extension Ecosystem

Harness 自身の Plugin Marketplace、Recipe、Package、App、Skill
System は引き続き Harness が所有します。Provider Adapter が Control
Plane を提供するのは、公式 Machine Interface が許可する場合だけです。

DeepSeek Harness Plugin Marketplace の例：

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

この Interface は DSH 公式 API を直接呼び出す必要があります。Adapter Core が npm
Installation を実行したり、DSH Profile を直接変更したり、Cordis
Lifecycle を複製したりしてはいけません。

Plugin Marketplace が Provider UI にのみ存在し、公開 Machine
Interface がない場合、Adapter は Management
Support を表明しません。User が Runtime に設定済みの Plugin は、引き続き Task
Execution に影響できます。

## 7. 代表的な Provider Extension

| Provider           | Extension 例                               | Provider に属する理由                                                    |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| DeepSeek Harness   | `deepseek.harness.plugins.marketplace`     | Cordis Plugin と Profile は DSH Native System である                     |
| Goose              | `goose.recipes`、`goose.extensions`        | Recipe と Extension Lifecycle は Goose が定義する                        |
| Qwen Code          | `qwen.code.goal`、`qwen.code.subagents`    | Goal と Custom Subagent はすべての Harness に共通する Semantics ではない |
| Codex Harness      | `openai.codex.apps`、`openai.codex.skills` | App と Skill は Codex App Server が定義する                              |
| GitHub Copilot CLI | `github.copilot.commands`                  | 利用可能な Slash Command は ACP Server が動的に公開する                  |
| Crush              | `charm.crush.lsp`、`charm.crush.mcp`       | LSP、MCP、Shared Workspace は Crush Service Model に属する               |
| OpenCode           | `opencode.commands`、`opencode.plugins`    | Command と Plugin は OpenCode Native Structure を保持する                |
| Cursor Agent CLI   | `cursor.rules`、`cursor.mcp`               | Rules と MCP 設定は Cursor 独自の Directory と Permission Model に従う   |

これらの名前は Design
Namespace です。実際の Extension をリリースできるのは、Provider
Adapter が実装し Test を通過した後だけです。

## 8. Capability 昇格ルール

Provider 固有 Capability が Public Optional
Capability に昇格できるのは、次のすべてを満たす場合だけです。

- 少なくとも 2 つの独立 Harness が公開 Machine Interface を提供する
- Lifecycle、Input、Output、Error に説明可能な共通 Semantics がある
- Public Interface がどの Provider の重要な動作も削除しない
- その Capability をサポートしない Provider が、偽の実装を必要とせず明示的に拒否できる
- Native Interface へ Extension または Native Client から引き続きアクセスできる
- Conformance
  Test が、単に Method 名が似ていることではなく、共通 Semantics を検証できる

それ以外は Provider Extension のまま保持します。

## 9. Portability

| 使用層              | Feature Coverage                    | Provider 間の Portability |
| ------------------- | ----------------------------------- | ------------------------- |
| Portable Core       | 共通の最小 Semantics                | 高                        |
| Optional Capability | 一部 Provider の共通動作            | 条件付き                  |
| Provider Extension  | 対応済み Provider の固有 Capability | なし                      |
| Native Client       | 公式 SDK/API からアクセス可能な動作 | なし                      |

Host は Module
Boundary でどの層を使うかを明示的に選択すべきです。完全な Portability を表明する Application
Interface の背後に Provider Extension を隠してはいけません。

## 10. カバーできない機能

正式 Adapter は次の機能を確実にカバーできません。

- GUI または Interactive Terminal でだけ操作できる機能
- 公開 SDK、RPC、HTTP API、安定 Machine Protocol がない機能
- TUI Text の解析、UI のクリック、未公開 Internal
  Function の呼び出しに依存する機能
- 公式 Interface が External Call を明示的に禁止する機能
- Provider 内部 Agent Loop の複製が必要な機能

公式インターフェースが不十分な場合、Provider
Adapter は Capability と文書に制限を明記します。正式 Support の代わりに壊れやすい Simulation を使いません。
