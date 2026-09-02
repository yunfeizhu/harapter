# Agent Note: Provider source availability

Status: implemented

## Problem

Provider Adapters depend on upstream machine interfaces whose lifecycle,
security, compatibility, and failure semantics must be reviewed independently.
An implementation can test a published client SDK without being able to inspect
the Harness that supplies its runtime behavior. That limits Harapter's ability
to investigate protocol drift, verify terminal authority, or maintain the
Adapter when the SDK and Harness disagree.

Source availability is not identical across every possible Provider. Harapter
needs to account for that difference without turning a target-provider research
entry into acceptance evidence or making Core depend on a Provider's licensing
model.

## Decision

Publicly reviewable Harness source is part of Provider acceptance evidence. A
published client SDK or protocol document does not, by itself, establish a
maintainable Provider boundary. When the Harness implementation is not publicly
reviewable, implementation requires a separate reviewed Agent Note that records
why the public interface, license, fixtures, compatibility probes, and live
evidence are sufficient for the proposed support claim.

Harapter does not maintain a Claude Provider Adapter. Its former workspace
package, fixtures, license record, tests, documentation entries, compatibility
record, and runtime dependency policy are absent. Core remains
provider-agnostic, so an independently maintained Adapter can still implement
the public Provider SPI without adding Provider-specific behavior to Core.

Target-provider research in the Provider matrix is not acceptance and does not
override this requirement.

## Alternatives considered

### Treat every official client SDK as sufficient acceptance evidence

An official SDK is preferable to scraping a user interface, but it exposes only
the client side of lifecycle and compatibility behavior. It may be insufficient
to diagnose or maintain the complete Harness boundary when the runtime
implementation is unavailable for review.

### Exclude every non-public Harness permanently

That rule would be stronger than the current project decision and would discard
future integrations before their public interfaces, licensing, operational
evidence, and user value can be reviewed. Requiring a separate acceptance
decision preserves that review point without treating a research entry as
support.

### Keep the removed Adapter as an experimental example

An experimental label limits support claims but still makes the package part of
the maintained workspace, documentation, dependency policy, and security
surface. Keeping that surface would misrepresent the current maintenance scope.

## Consequences

- Provider reviews record whether the Harness implementation itself is publicly
  inspectable, in addition to its machine interface and license.
- A source-unavailable Harness cannot enter the maintained workspace solely
  because an official SDK exists.
- Removing the Claude Adapter also removes its package, fixtures, license
  record, tests, documentation entries, and runtime dependency policy.
- Target-provider research remains possible but makes no support or acceptance
  claim.
- Third parties can implement the provider-neutral SPI independently; their
  compatibility and support claims remain outside the Harapter repository.
