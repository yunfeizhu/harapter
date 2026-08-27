# Agent Note: Portable Core and provider boundaries

Status: proposed

## Problem

Agent harnesses expose incompatible session, run, event, interaction, transport,
and extension concepts. Letting host applications or Core branch on provider
identity would make every new adapter a cross-repository change and would turn
upstream differences into implicit behavior.

## Proposal

Harapter will separate language-neutral portable contracts, a provider-agnostic
Core, transport implementations, shared conformance tests, and independently
owned provider adapters. Core will depend only on canonical clients, sessions,
runs, events, interactions, capabilities, errors, and extension dispatch.
Provider packages will translate documented public machine interfaces and
contain all provider-specific terminology and SDK dependencies.

Behavior without a portable semantic equivalent will remain a typed provider
extension or explicit native escape hatch. Harapter will not implement an agent
loop or move native checkpoints between providers. The target structure is
defined by the [architecture](../../../../docs/design/architecture.md) and
[API design](../../../../docs/design/api-design.md).

## Alternatives considered

### Provider conditionals inside Core

Central conditionals initially reduce package count but make Core releases
depend on every upstream harness and allow provider identity to become hidden
behavior. This prevents independent compatibility releases and was rejected.

### Lowest-common-denominator API only

Removing capabilities, extensions, and native access creates a small interface
but makes important provider behavior unreachable and encourages untyped escape
through arbitrary metadata. Harapter instead keeps a small portable core with
explicit optional capabilities and typed extensions.

### One universal checkpoint format

Native checkpoints encode provider-owned execution state and cannot be
translated safely without implementing provider internals. Sessions therefore
remain bound to their creating provider and profile.

## Acceptance criteria

The proposal is implemented when portable contracts and Core exist without
provider identity checks or provider SDK imports, provider-specific behavior is
confined to adapters and typed extensions, and shared conformance tests exercise
the package boundaries. Provider acceptance claims must have executable
evidence.

## Risks

The package split adds mapping and conformance work, and some workflows will
need provider extensions rather than portable methods. Until the acceptance
criteria are met, the design documents describe target behavior rather than a
shipped runtime contract.
