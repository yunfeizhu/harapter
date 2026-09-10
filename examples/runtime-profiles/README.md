# Single calls and explicit Sessions

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

The SDK guide starts with two independent, one-file examples. Copy the one you
need as `app.ts`; neither imports a Runtime configuration file:

- [Pi: quick-run.ts](src/quick-run.ts)
- [DSH: quick-dsh-run.ts](src/quick-dsh-run.ts)

[SDK](../../packages/harapter/README.md) ·
[API](../../docs/api-reference.md#run)

`run()` is an additive API introduced after `harapter@1.0.0`. Version 1.0.0 does
not contain it; use a release or source build that includes this API.

The selected harness must already be installed and authenticated, or its HTTP
service must be running. Harapter uses that Runtime and its native
tool/permission policy. A task may access the chosen workspace and incur model
charges.

Each `run()` creates a fresh Session and returns the authoritative `RunResult`,
including `failed`, `cancelled` or `connection_aborted`. A returned result is
not always success. Setup, observer and cleanup failures reject with a safe
`HarnessError`; inspect `error.code` using `isHarnessError`.

The default whole-call deadline is 60 seconds; change it with `timeoutMs`.
Expiry rejects with `timeout` and closes owned connections. This does not prove
native cancellation; a remote task may continue. Cleanup may extend beyond the
deadline, and late connection/session handles are closed when they arrive.

`run()` does not answer approvals or user-input requests:
`interaction.requested` rejects with `unsupported_capability`. For interactive
or multi-turn tasks, resume, fork, native cancellation, custom connection
policies or DSH Gateway, use the Client/Session API below. Closing handles does
not delete native history or stop externally owned servers.

## Advanced: application-owned connection Profiles

The longer recipes remain available when an application needs explicit Session
ownership. Copy `quick-start.ts` and `runtime-config.ts` together, or adapt the
reusable `runTask` service helper. These are alternatives to the single-call
API, not prerequisites for it.

- [quick-start.ts](src/quick-start.ts)
- [runtime-config.ts](src/runtime-config.ts)
- [runTask](src/quick-unified.ts)

`pnpm --filter @harapter/example-runtime-profiles start`

The single-call API is exercised through all six existing Adapter fixtures. The
isolated tarball consumer compiles these exact entry files and runs DSH, Pi and
authenticated OpenCode tasks using only the installed `harapter` package. These
deterministic checks do not replace live Runtime evidence.

## Continue a conversation

Use `openSession()` once, then call `send()` for each message. The same native
Session keeps the conversation history. This API is added after 1.0.0 and is not
yet in that release.

[quick-chat.ts](./src/quick-chat.ts) ·
[Runtime guide](../../packages/harapter/README.md)
