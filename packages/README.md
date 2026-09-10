# Public SDK and private source modules

Harapter publishes **one npm package:
[`harapter`](https://www.npmjs.com/package/harapter)**. Application developers
should start with its [SDK guide](./harapter/README.md) and import the common
API from `harapter`.

The other directories here contain implementation code and tests used to build
that SDK. They have `private: true` in their manifests and are not separate
packages that consumers need to install. Workspace manifests let repository
contributors build and test each boundary independently.

| Directory                                                        | Role                   | Responsibility                                                                       |
| ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| [`harapter`](./harapter/README.md)                               | Public package         | Exposes the common application API and bundles the maintained implementations.       |
| [`core`](./core/README.md)                                       | Private implementation | Portable contracts, Registry, capabilities, ownership checks, errors and extensions. |
| [`transport-jsonrpc-stdio`](./transport-jsonrpc-stdio/README.md) | Private implementation | Bidirectional JSON-RPC framing, correlation, backpressure and stream lifecycle.      |
| [`transport-jsonl-process`](./transport-jsonl-process/README.md) | Private implementation | Bounded JSONL framing and process streams for protocols that are not JSON-RPC.       |
| [`transport-http-sse`](./transport-http-sse/README.md)           | Private implementation | Bounded HTTP requests and Server-Sent Events parsing.                                |
| [`transport-acp`](./transport-acp/README.md)                     | Private implementation | ACP negotiation, permission messages and Session updates over JSON-RPC stdio.        |
| [`conformance`](./conformance/README.md)                         | Private test support   | Shared portable behavior tests and the deterministic Fake Provider.                  |

Harness mappings live in the private modules under
[`providers/`](../providers/README.md). Only the `harapter` composition layer
selects them; Core, transports and conformance remain provider-agnostic.

These implementations are still needed. Deleting `core` or a transport would
remove code used by the SDK, not merely remove an old npm listing. Their source
directory layout is an internal organization choice and does not require a
multi-package consumer API.

Only `harapter` is listed in
[`scripts/public-packages.json`](../scripts/public-packages.json) and published
to npm `latest`. The [SDK build](../scripts/build-harapter.mjs) bundles the
private source modules and their declarations into its `dist` directory.
Internal module versions are workspace build metadata, not separate public
release versions. Runtime installation and authentication remain owned by the
host application.
