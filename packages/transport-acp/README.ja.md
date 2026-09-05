<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-acp</code></h1>

<p align="center"><strong>stable Agent Client Protocol v1 の strict Provider-neutral client。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-acp/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-acp?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/transport-jsonrpc-stdio` を組み合わせ、stable ACP v1
negotiation、Session method、Prompt、typed update、Permission
Request、Capability Gate、未知 message の bounded observation を実装します。ACP
Agent の起動、Provider 選択、Harapter Event mapping は行いません。

## インストール

```bash
pnpm add @harapter/transport-acp@next
```

## クイックスタート

```ts
import { AcpClient } from '@harapter/transport-acp';

const client = new AcpClient({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
  requestPermission: async (request) =>
    decidePermissionWithoutLoggingRawFields(request),
});

await client.initialize({
  clientInfo: { name: 'harapter-provider', version: 'current' },
});

const session = await client.newSession({
  cwd: controlledWorkspace,
  mcpServers: [],
});

const eventTask = (async () => {
  for await (const event of client.events()) {
    await handleValidatedAcpEvent(event);
  }
})();

await client.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: controlledPrompt }],
});

await client.close();
await eventTask;
```

## 実装済み ACP v1 範囲

- JSON-RPC `"2.0"` と `protocolVersion: 1` の厳密な negotiation；
- `session/new` と Capability-gated load/list/delete/resume/close；
- `session/prompt`、stable v1 `session/update`、`session/cancel`；
- `session/request_permission` と `_` で始まる明示的 extension method；
- 将来・未知 message の bounded redacted observation。

ACP v2、authentication、logout、terminal、filesystem、elicitation、Session
mode、Session configuration method は現在の stable profile 外です。未実装 Client
Service を Capability として宣言することはできません。

## ライフサイクル要点

- connection ごとに initialize は一回、Session ごとに active Prompt は一つです；
- 検証済み `session/prompt` response と stable stop
  reason だけが終端 authority です；
- `cancelSession()` の notification
  write 成功だけでは cancellation を証明しません；
- local
  timeout/abort は cancel を送らず、未確認 Prompt は Session 再利用を止めます；
- `events()` の consumer は一つで、既定の未読上限は 128 です；
- 未知 message は success に変換されず、raw
  observation の文字列や ID は hash または除去されます。

Extension callback、Permission Payload、Tool Raw Input/Output、Remote
Error は明示的 unredacted boundary です。全 protocol と race semantics は
[英語の詳細ドキュメント](./README.md)を参照してください。
