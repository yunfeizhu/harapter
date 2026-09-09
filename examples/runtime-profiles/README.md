# Runtime profiles through one Harapter entry

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

This private example is the maintained source of the
[application entry guide](../../packages/harapter/README.md). Its DSH and
OpenCode configurations share `runTask`; change `HARAPTER_HARNESS` to select the
connection. Follow the guide for Runtime installation, authentication, workspace
safety and environment variables. A real call may incur model charges. The
application closes its connections and owned process, while external services
remain running. Session state never migrates between harnesses.

The first `harapter` npm release is pending. All repository examples use the
private Workspace composition during development. After release, install
`harapter`, copy [src/quick-unified.ts](src/quick-unified.ts) as `app.ts`, and
run `node app.ts`.

For local source verification after the repository build, run
`pnpm --filter @harapter/example-runtime-profiles start`. Unit integration tests
and the isolated tarball consumer exercise this same business function with
synthetic DSH process and authenticated OpenCode HTTP fixtures, without model
credentials.
