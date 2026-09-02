[English](./provider-extensions.md) · [简体中文](./provider-extensions.zh-CN.md)
· [日本語](./provider-extensions.ja.md)

# Provider-specific capabilities

## 1. Design goals

Different Harnesses naturally have different design priorities, state models,
and Extension systems. An Adapter should not remove their distinctive
capabilities merely to create superficial uniformity.

The correct coverage guarantee is:

> Portable capabilities remain portable, Provider-specific capabilities remain
> accessible, and the unifying layer does not discard official programmable
> behavior.

It does not guarantee that Portable Core can call every feature or that every
graphical-interface feature has a machine interface.

## 2. Three-layer call model

### 2.1 Portable Core

Portable Core serves application code that needs to select or switch a Harness:

```ts
const session = await client.createSession();
const run = await session.start(input);

for await (const event of run.events()) {
  render(event);
}
```

This code depends on no Provider name or native type and can be reused across
Providers such as Qwen, OpenCode, and Codex.

### 2.2 Optional Capability

An Optional Capability represents behavior with similar semantics across several
Providers that not every Provider supports:

```ts
if (capabilities.capabilities['session.resume']?.mode === 'native') {
  await client.resumeSession(ref);
}
```

Behavior enters the public Capability namespace only after real mappings from at
least two independent Providers prove it and a common contract preserves the
important semantics.

### 2.3 Provider Extension

Provider-specific behavior enters a Provider namespace:

```ts
const recipes = client.extensions().get<GooseRecipes>('goose.recipes');
const goals = client.extensions().get<QwenGoals>('qwen.code.goal');
const apps = client.extensions().get<CodexApps>('openai.codex.apps');
```

Code using these interfaces is explicitly bound to that Provider and does not
claim that it can switch Harnesses without modification.

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

Core maintains no Extension enum and executes no Provider logic based on an
Extension name. A host UI may offer a specialized interface for a known
Extension, while an unknown Extension remains accessible through its Descriptor
and Provider-owned UI or API.

## 4. Native Escape Hatch

A Provider Adapter should expose the official SDK Client or an equivalent public
protocol Client:

```ts
const native = client.native<OfficialProviderClient>();
```

The Native Escape Hatch addresses two cases:

- the official interface supports behavior for which the Adapter does not yet
  provide a typed Extension; and
- an advanced caller needs official objects, methods, Events, or protocol
  fields.

The Native Client does not undergo Core semantic translation. Its parameters,
Errors, authentication, and stability follow the official Provider interface.
Code that uses it owns its Provider binding and version compatibility.

## 5. Raw Event

When a Provider sends an Event unknown to the Adapter, its HarnessEvent mapping
contains at least this fragment:

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

Raw Events are disabled by default and remain bounded in size and rate and
subject to redaction when enabled. They support diagnostics and advanced
features; they do not allow a host to bypass the portable Event model and read
all private Reasoning or sensitive Tool results.

## 6. Plugin marketplaces and Extension ecosystems

A Harness continues to own its plugin marketplace, Recipe, Package, App, or
Skill system. A Provider Adapter exposes a control plane only when the official
machine interface permits it.

For example, a DeepSeek Harness plugin marketplace could expose:

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

This interface must call the official DSH API directly. Adapter Core does not
run npm installation itself, modify a DSH Profile directly, or copy the Cordis
lifecycle.

If a plugin marketplace exists only in the Provider UI and has no published
machine interface, the Adapter does not claim management support. Plugins that
the user already configured in the Runtime can still affect task execution.

## 7. Common Provider Extensions

| Provider           | Example Extension                          | Why it belongs to the Provider                                                 |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| DeepSeek Harness   | `deepseek.harness.plugins.marketplace`     | Cordis plugins and Profiles are native DSH systems                             |
| Goose              | `goose.recipes`, `goose.extensions`        | Goose defines the Recipe and Extension lifecycle                               |
| Qwen Code          | `qwen.code.goal`, `qwen.code.subagents`    | Goals and Custom Subagents are not shared semantics across all Harnesses       |
| Codex Harness      | `openai.codex.apps`, `openai.codex.skills` | Codex App Server defines Apps and Skills                                       |
| GitHub Copilot CLI | `github.copilot.commands`                  | The ACP Server publishes the available Slash Commands dynamically              |
| Crush              | `charm.crush.lsp`, `charm.crush.mcp`       | LSP, MCP, and the shared Workspace belong to the Crush service model           |
| OpenCode           | `opencode.commands`, `opencode.plugins`    | Commands and Plugins retain their native OpenCode structure                    |
| Cursor Agent CLI   | `cursor.rules`, `cursor.mcp`               | Rules and MCP configuration follow Cursor's own directory and permission model |

These names are design namespaces. An Extension can be released only after its
Provider Adapter implements and tests it.

## 8. Capability promotion rules

A Provider-specific capability is suitable for promotion to a public Optional
Capability only when all of the following hold:

- at least two independent Harnesses publish a machine interface for it;
- lifecycle, inputs, outputs, and Errors have explainable common semantics;
- the public interface does not remove important behavior from any Provider;
- Providers that do not support it can reject it explicitly without a fabricated
  implementation;
- the native interface remains accessible through an Extension or Native Client;
  and
- a Conformance Test can verify the common semantics, not merely similar method
  names.

Otherwise, it remains a Provider Extension.

## 9. Portability

| Usage layer         | Feature coverage                        | Cross-Provider portability |
| ------------------- | --------------------------------------- | -------------------------- |
| Portable Core       | Shared minimum semantics                | High                       |
| Optional Capability | Shared behavior across some Providers   | Conditional                |
| Provider Extension  | Adapted Provider-specific capabilities  | None                       |
| Native Client       | Behavior accessible in official SDK/API | None                       |

A host should choose the layer explicitly at a module boundary. It must not hide
a Provider Extension behind an application interface that claims complete
portability.

## 10. Behavior that cannot be covered

A formal Adapter cannot reliably cover:

- behavior available only through a graphical interface or interactive terminal;
- behavior without a published SDK, RPC, HTTP API, or stable machine protocol;
- behavior that requires parsing TUI text, clicking a UI, or calling unpublished
  internal functions;
- behavior that the official interface explicitly forbids external callers to
  invoke; or
- behavior that requires copying the Provider's internal Agent Loop.

When the official interface is insufficient, the Provider Adapter states the
limitation in Capabilities and documentation. It does not substitute a brittle
simulation for formal support.
