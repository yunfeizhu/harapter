# Harapter API リファレンス

[English](./api-reference.md) · [简体中文](./api-reference.zh-CN.md) ·
[日本語](./api-reference.ja.md)

`harapter`
が公開する実装済みのアプリケーション API を調べるための文書です。最初の呼び出しには
[SDK チュートリアル](../packages/harapter/README.ja.md)を使ってください。
[SDK のエクスポート](../packages/harapter/src/index.ts)と
[共通の型宣言](../packages/core/src/contracts.ts)に基づき、
[目標設計](./design/api-design.ja.md)を実装済みの機能として扱いません。
[SDK ガイド](../packages/harapter/README.ja.md)と
[Core ガイド](../packages/core/README.ja.md)が実行時の意味を、各 Provider ガイドが対応オプション、イベントのペイロード、互換範囲を管理します。

単一タスクには `run()` を使います。明示的な Session 管理には `createHarapter` →
`connect` → `createSession` → `start` → `events` / `result` → `close`
を使います。

| 調べる内容                             | 参照先                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| 単一タスクを実行してハンドルを解放する | [run](#run)                                                                       |
| Harness の選択と認証                   | [createHarapter](#createharapter)                                                 |
| Runtime 接続の設定                     | [HarnessProfile](#harnessprofile)                                                 |
| 接続、Session の作成と再開             | [HarnessRegistry](#harnessregistry)、[HarnessClient](#harnessclient)              |
| 入力と対話処理                         | [HarnessSession](#harnesssession)、[HarnessInput](#harnessinput)、[対話](#対話)   |
| ストリーム、キャンセル、最終応答       | [HarnessRun](#harnessrun)、[RunResult](#runresult)、[HarnessEvent](#harnessevent) |
| オプション機能と失敗の確認             | [Capability](#capability)、[HarnessError](#harnesserror)                          |
| Provider 固有の動作                    | [Extension と Native Access](#extension-と-native-access)                         |

## run

`run(request: RunRequest): Promise<RunResult>`

`run()` は `harapter@1.0.0`
の後に追加された API です。1.0.0 には含まれないため、この API を含む後続リリースまたはソースビルドを使用してください。

単発の入口は Core の外で既存 Adapter を選び、イベントを読み、所有ハンドルを解放して Provider の最終結果を返します。Runtime のインストール、ログイン、権限ポリシーの変更は行いません。

| フィールド   | 意味                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness`    | `HarnessName`：`codex`、`dsh`、`pi`、`openclaw`、`opencode`、`hermes`。                                                                                          |
| `input`      | 新規タスクへの空でないテキスト。                                                                                                                                 |
| `cwd?`       | ローカルプロセスの Workspace。既定値は `process.cwd()`。OpenCode はサーバー側の絶対パスを受け付け、省略時はサーバー既定値を使います。Hermes では指定できません。 |
| `model?`     | `RunModel`：`{ id: string; provider?: string }`。選択規則は下表を参照。                                                                                          |
| `command?`   | 実行ファイルのパス、または絶対 `PATH` エントリのコマンド名。Shell、インストール、暗黙のカレントディレクトリ検索は使いません。                                    |
| `args?`      | 既定の機械インターフェース引数を置き換えます。Adapter 必須のプロトコル引数は適用されます。                                                                       |
| `url?`       | OpenCode または Hermes の HTTP 基底 URL。既定値は下表を参照。認証情報を URL に埋め込まないでください。                                                           |
| `headers?`   | ホストの秘密情報ストレージからの HTTP ヘッダー。私有 resolver に複製され、Profile や SessionRef には入りません。                                                 |
| `timeoutMs?` | 呼び出し全体の期限。既定値 `60000`、`2147483647` 以下の正の安全な整数。接続と非同期コールバックを含み、解放にはさらに時間がかかる場合があります。                |
| `onEvent?`   | `(event: HarnessEvent) => void \| Promise<void>`。順番に呼び出され、失敗時は秘匿化した `provider_error` になります。                                             |

### 既定の接続とモデル選択

| Harness    | Connection                      | Model                                                                |
| ---------- | ------------------------------- | -------------------------------------------------------------------- |
| `codex`    | `codex app-server --stdio`      | 任意の `model.id`。モデル Provider は Codex で設定。                 |
| `dsh`      | `dsh --profile sdk`             | `model.provider` と `model.id` の両方が必要。                        |
| `pi`       | `pi` と Adapter の RPC/隔離引数 | Runtime 設定を使用。`run.model` は未対応。                           |
| `openclaw` | `openclaw acp`                  | Runtime 設定を使用。`run.model` は未対応。                           |
| `opencode` | `http://127.0.0.1:4096`         | モデルを指定する場合は `model.provider` と `model.id` の両方が必要。 |
| `hermes`   | `http://127.0.0.1:8642`         | 任意の `model.id` と `model.provider`。                              |

プロセス呼び出しは HTTP オプションを、HTTP 呼び出しはプロセスオプションを拒否します。未対応のモデルや Workspace 指定は
`unsupported_capability`、不正または不完全な設定は
`invalid_request`、ローカル実行ファイル不在は `runtime_not_found` になります。

期限切れは `timeout`
と接続の中断であり、検証されたネイティブキャンセルではありません。対話に自動応答せず
`unsupported_capability`
で失敗します。呼び出しごとに新しい Session を作り、解放後もネイティブ状態が残る場合があります。継続やキャンセルには Session
API を使います。詳細は SDK ガイドを参照してください。

[RunRequest / RunModel](../packages/harapter/src/run-types.ts) ·
[SDK](../packages/harapter/README.ja.md)

## openSession

`openSession(options: RuntimeOptions): Promise<ChatSession>`

`openSession()` を一度呼び、各メッセージを `send()` で送信します。同じ native
Session が履歴を保持します。この API は 1.0.0 より後の追加であり、1.0.0 リリースには含まれません。

`RuntimeOptions = Omit<RunRequest, 'input' | 'onEvent'>`.
`ChatSession extends HarnessSession`, with
`send(input: string, options?: SendOptions): Promise<RunResult>` and
`readonly client: HarnessClient`.

一つの会話で同時に実行できる Run は一つです。`send()`
は Event を消費し、`{ timeoutMs, onEvent }` を受け付けます。既定期限は
`openSession()` の値（未指定なら 60000
ms）です。Observer、期限、Interaction の失敗時は所有 Connection を閉じます。これは native
Cancellation の証明ではありません。Interaction は継承した `start()` /
`respond()`、対応する取消は Run の `cancel()` を使います。`chat.client`
で同じ Connection の Capability、Extension、Resume、Native
Control にアクセスできます。chat の Close は Client も閉じるため、独立管理や Resume が必要なら Client/Session
API を使ってください。

### runtime

`run()` と `openSession()` は同じ `RuntimeOptions` を使います。`runtime`
を省略すると文書化された CLI または HTTP の既定接続を使います。Harapter
adapter の追加 import は不要です。

- `PiSdkRuntime`:
  `{ kind: 'pi-sdk', version: '0.85.1', createSession: PiSdkSessionFactory }`.
- `DshGatewayRuntime`: `DshGatewayProfileOptions` +
  `{ kind: 'dsh-gateway', url, resolveCookie(signal) }`.
- `OpenClawAcpRuntime`:
  `{ kind: 'openclaw-acp', gateway: OpenClawGatewayBinding }`.

OpenCode と Hermes は HTTP/SSE を使用し、Harapter 管理の SDK
Subprocess は不要です。Codex は App Server stdio を使用します。OpenClaw の Run
Transport は ACP のままで、`runtime: { kind: "openclaw-acp", gateway }` に既存の
`OpenClawGatewayBinding`
を渡せます。profileId は保持されます。Gateway は対応する native Session
Control のみを追加し、Harapter は破棄しません。

[RuntimeOptions](../packages/harapter/src/run-types.ts) ·
[Runtime bindings](../packages/harapter/src/runtime-types.ts) ·
[SDK guide](../packages/harapter/README.ja.md)

## createHarapter

`openClawGateway?: OpenClawGatewayBinding` は既存の Host Binding を一致する ACP
Profile に渡します。

`createHarapter(options?: HarapterOptions): Promise<HarnessRegistry>`

選択した組み込みプロトコル実装を読み込みます。Runtime のインストールや接続は行いません。
`options` を省略すると空の Registry を返します。設定オブジェクトを渡す場合は
`harnesses` が必須です。重複した名前は一度だけ読み込みます。

| HarapterOptions のフィールド | 型と用途                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harnesses`                  | `readonly HarnessName[]`。下表から選択します。                                                                                                                  |
| `resolveAuthHeaders?`        | `(reference: SecretRef) => Readonly<Record<string, string>> \| Promise<Readonly<Record<string, string>>>`。OpenCode と Hermes HTTP の認証をホストが提供します。 |
| `resolveGatewayCookie?`      | `(reference: SecretRef, signal: AbortSignal) => string \| Promise<string>`。DSH Gateway の認証をホストが提供します。                                            |

`SecretRef` は `scheme: string` と `id: string`
を持ちます。Resolver はその参照が許可されているかを確認してから認証情報を返します。Harapter は共通のモデル API
Key 環境変数を読み取りません。モデル認証は各 Runtime が担当します。

| HarnessName | Profile providerId  | Runtime の設定と制限                           |
| ----------- | ------------------- | ---------------------------------------------- |
| `codex`     | `openai.codex`      | [Codex](../providers/codex/README.ja.md)       |
| `dsh`       | `deepseek.harness`  | [DSH](../providers/dsh/README.ja.md)           |
| `hermes`    | `nous.hermes-agent` | [Hermes](../providers/hermes/README.ja.md)     |
| `openclaw`  | `openclaw`          | [OpenClaw](../providers/openclaw/README.ja.md) |
| `opencode`  | `opencode`          | [OpenCode](../providers/opencode/README.ja.md) |
| `pi`        | `pi.agent`          | [Pi](../providers/pi/README.ja.md)             |

無効な選択は `invalid_request`、組み込み実装を初期化できない場合は
`provider_api_incompatible` で拒否します。

## HarnessProfile

Profile は一つの接続設定を識別します。Profile の切り替えは新しい Client の Runtime を選択し、既存の Session は移動しません。

| フィールド              | 型と用途                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `profileId`             | `ProfileId`。`profileId('local-dsh')` で作成する、ホスト側の接続設定 ID。                             |
| `providerId`            | `ProviderId`。`providerId('deepseek.harness')` で作成し、登録済み Provider と一致する必要があります。 |
| `displayName`           | `string`。表示名。                                                                                    |
| `connection`            | `ProviderConnection`。以下の形式から一つ選びます。                                                    |
| `providerOptions?`      | `Readonly<Record<string, unknown>>`。選択した実装が対応する設定。                                     |
| `requiredCapabilities?` | `readonly CapabilityRequirement[]`。`connect` が返る前に検証します。                                  |
| `metadata?`             | `Readonly<Record<string, string>>`。ホストのメタデータ。                                              |

`ProviderConnection` は `kind`
で区別するユニオン型です。型の存在は全ての実装による対応を意味しません。

| kind           | フィールド                                                                                                     | ownership                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `process`      | `command: string`、`args?: readonly string[]`、`cwd?: string`、`envRefs?: Readonly<Record<string, SecretRef>>` | `host`、`adapter` または `external` |
| `endpoint`     | `url: string`、`transport?: 'http' \| 'sse' \| 'websocket' \| 'acp'`、`authRef?: SecretRef`                    | `host` または `external`            |
| `local_socket` | `path: string`、`transport: 'http' \| 'jsonrpc' \| 'acp'`、`authRef?: SecretRef`                               | `host` または `external`            |
| `sdk`          | `client?: unknown`、`factory?: unknown`                                                                        | `host` または `adapter`             |

`ownership`
は必須です。対応する値、プロセス引数、認証、終了時の処理は Runtime ガイドに従ってください。任意の
`sdk.client` オブジェクトを自動検出して適合させる仕組みではありません。

## HarnessRegistry

| メソッド                                    | 戻り値                            | 動作                                                                                  |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `connect(profile: HarnessProfile)`          | `Promise<HarnessClient>`          | 登録済み Provider に接続し、接続種別、記述と能力の所有者 ID、必要な能力を検証します。 |
| `listProviders()`                           | `readonly ProviderDescriptor[]`   | 登録順のメタデータ。                                                                  |
| `getProvider(id: ProviderId)`               | `ProviderDescriptor \| undefined` | 一つの登録済み実装を検索します。                                                      |
| `register(factory: ProviderAdapterFactory)` | `void`                            | カスタム実装を追加します。Provider ID の重複は `invalid_request` です。               |
| `unregister(id: ProviderId)`                | `void`                            | 登録を削除します。既存の Client は閉じません。                                        |

組み込み実装には `createHarapter` を使います。独自の構成には
`new HarnessRegistry()` を使えます。Factory は `descriptor()` と
`connect(profile)` を実装します。`ProviderDescriptor` は `providerId`、
`displayName`、`connectionKinds` と任意の `documentationUrl` を含みます。

## HarnessClient

| メソッド                                         | 戻り値                        | 動作                                                                     |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `descriptor()`                                   | `Promise<ClientDescriptor>`   | 現在の Provider/Profile ID、接続種別、Runtime メタデータ、互換性と警告。 |
| `capabilities(options?: CapabilityProbeOptions)` | `Promise<CapabilityManifest>` | 観測済みの能力。`refresh: true` で更新を要求できます。                   |
| `createSession(input?: CreateSessionInput)`      | `Promise<HarnessSession>`     | この接続に Session を作成します。                                        |
| `resumeSession(ref: SessionRef)`                 | `Promise<HarnessSession>`     | 対応している場合、所有者と互換性を検証して状態を再開します。             |
| `extensions()`                                   | `ProviderExtensionRegistry`   | Provider 固有の拡張を検索します。                                        |
| `native<T = unknown>(guard?)`                    | `T \| undefined`              | 明示的なネイティブアクセス。後述します。                                 |
| `close()`                                        | `Promise<void>`               | 接続の所有権に従って Client を冪等に解放します。                         |

`ClientDescriptor.compatibility` は `supported`、`experimental` または
`unsupported`
です。メソッドが存在しても再開や対話への対応は保証されません。能力と Runtime ガイドを確認してください。ハンドルを閉じることは保存済みのネイティブ履歴を削除することではありません。

## HarnessSession

| メソッド                                                    | 戻り値                        | 動作                                                            |
| ----------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `ref()`                                                     | `SessionRef`                  | 所有する Provider、Profile、ネイティブ Session の不透明な参照。 |
| `capabilities()`                                            | `Promise<CapabilityManifest>` | Session の能力観測。                                            |
| `start(input: HarnessInput, options?: RunOptions)`          | `Promise<HarnessRun>`         | この Session でタスクを開始します。                             |
| `respond(requestId: string, response: InteractionResponse)` | `Promise<void>`               | 対応する保留中の対話に応答します。                              |
| `close()`                                                   | `Promise<void>`               | Session を冪等に解放します。                                    |

`CreateSessionInput` のフィールドは全て任意です。

| フィールド        | 型と用途                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `workspace`       | `WorkspaceRef`：`{ uri: string }`。Runtime 側の Workspace。                                                             |
| `systemContext`   | `string`。実装が対応している場合のコンテキスト。                                                                        |
| `model`           | `ModelSelection`：`{ id: string; providerOptions?: Readonly<Record<string, unknown>> }`。Runtime が解釈するモデル選択。 |
| `providerOptions` | `Readonly<Record<string, unknown>>`。ネイティブ Session 設定。                                                          |
| `metadata`        | `Readonly<Record<string, string>>`。ホストのメタデータ。                                                                |

`SessionRef` は `providerId`、`profileId`、`providerSessionId`、任意の
`compatibilityRef` と不透明な `providerState`
を含みます。再開に必要な場合、認可されたホストストレージに保存します。Provider を変更するために書き換えたり、汎用ログに出力したりしないでください。複数ターンでは同じ Session に次の Run を開始します。同時 Run は
`run_conflict` になる場合があります。分岐やネイティブ履歴操作は対応する Provider
Extension を使い、共通の `session.fork()` はありません。

## HarnessInput

`HarnessInput` は `parts: readonly InputPart[]` が必須で、
`metadata: Readonly<Record<string, string>>` は任意です。

| InputPart.type | 必須フィールド                   | 任意フィールド      |
| -------------- | -------------------------------- | ------------------- |
| `text`         | `text: string`                   | —                   |
| `file_ref`     | `uri: string`                    | `mediaType: string` |
| `image_ref`    | `uri: string`                    | `mediaType: string` |
| `provider`     | `name: string`、`value: unknown` | —                   |

テキスト入力は `{ parts: [{ type: 'text', text: 'Hello!' }] }`
の形式です。ファイル、画像、ネイティブ入力には実装の対応が必要です。型への所属だけでは Runtime が受け入れる証拠になりません。

`RunOptions` の任意フィールドは `timeoutMs: number`、
`providerOptions: Readonly<Record<string, unknown>>`、
`metadata: Readonly<Record<string, string>>` です。共通の `signal`
フィールドはありません。期限の設定はネイティブキャンセルを保証しません。

## HarnessRun

| メソッド   | 戻り値                        | 動作                                                            |
| ---------- | ----------------------------- | --------------------------------------------------------------- |
| `ref()`    | `RunRef`                      | Provider/Profile/Session ID、`runId` と任意の `providerRunId`。 |
| `events()` | `AsyncIterable<HarnessEvent>` | Run の実行中、`for await` で継続して消費します。                |
| `result()` | `Promise<RunResult>`          | 確定した終端結果。                                              |
| `cancel()` | `Promise<CancelResult>`       | キャンセルを要求し、実際のモードを返します。                    |

`CancelResult.mode` は `native`、`emulated`、`connection_aborted` または
`already_terminal`
です。返されたモードと最終結果を確認してください。接続中断と Runtime 内でのネイティブ停止は異なります。ホスト側の構成は[キャンセルのレシピ](../examples/sdk-application/README.ja.md#用途別レシピ)を参照してください。

## RunResult

| フィールド        | 型と用途                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `status`          | `completed`、`cancelled`、`failed` または `connection_aborted`。成功完了は `completed` のみです。     |
| `finalMessage?`   | `string`。Provider が公開する最終テキスト。成功時も存在するとは限りません。                           |
| `usage?`          | `UsageSummary`。任意の数値 `inputTokens`、`outputTokens`、`totalTokens`。欠損値はゼロではありません。 |
| `providerResult?` | `unknown`。認可されたホスト境界内で扱う Provider 固有の結果。                                         |

例外の捕捉と、非成功の結果の処理が必要です。EOF やイベントストリームの終了だけでは成功を証明できません。

## HarnessEvent

各イベントは `id`、`type`、`providerId`、`profileId`、`sessionId`、`runId`、
`sequence`、`timestamp`、`data` を持ちます。任意の `providerEventType` と `raw`
が Provider の情報を保持します。`sequence` は Run 内の順序を表します。

| 分類           | HarnessEventType の値                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| ライフサイクル | `run.started`、`run.completed`、`run.cancelled`、`run.failed`、`connection.aborted` |
| メッセージ     | `message.delta`、`message.completed`                                                |
| 推論           | `reasoning.delta`、`reasoning.completed`                                            |
| ツール         | `tool.started`、`tool.updated`、`tool.completed`                                    |
| 対話           | `interaction.requested`、`interaction.resolved`                                     |
| その他         | `artifact.created`、`usage.updated`、`provider`                                     |

`HarnessEvent<T = unknown>` の `data` は `T` 型で、既定は `unknown`
です。外側の構造とイベント名は共通ですが、ペイロードは各実装に従います。`event.data.text`
の存在を仮定しないでください。未知の上流イベントは上限付きで秘匿化された Provider チャネルに入り、成功を意味しません。描画前に Provider ガイドを確認し、汎用ログはメタデータに限定してください。

## 対話

`InteractionRequest` は `requestId`、`kind`（`approval`、`user_input` または
`provider`）、任意の `title`、`prompt`、`schema`、`providerState`
を持ちます。処理前に現在の実装のイベントペイロードを検証してください。

| InteractionResponse.kind | 応答フィールド                                                     |
| ------------------------ | ------------------------------------------------------------------ |
| `approval`               | `decision: 'approve' \| 'deny'`、任意の `providerOptions: unknown` |
| `user_input`             | `parts: readonly InputPart[]`                                      |
| `provider`               | `value: unknown`                                                   |

対応する要求 ID と応答を `session.respond`
に渡します。対応範囲と関連付けの規則は Provider が定義します。承認 UI とポリシーはホストが担当し、汎用タイトルはツール操作の安全性を証明しません。[対話のレシピ](../examples/sdk-application/README.ja.md#用途別レシピ)を参照してください。

## Capability

`CapabilityManifest` は `providerId`、`profileId`、`observedAt`、任意の
`runtimeIdentity` と `capabilities: Readonly<Record<string, CapabilityStatus>>`
を含みます。

| CapabilityStatus.mode | 意味                                 |
| --------------------- | ------------------------------------ |
| `native`              | Runtime がネイティブに提供します。   |
| `emulated`            | Adapter が動作をエミュレートします。 |
| `adapter_controlled`  | Adapter 境界で動作を制御します。     |
| `unsupported`         | 現在の実装は明示的に非対応です。     |
| `unknown`             | 対応が確認されていません。           |

キーの欠損は Adapter がその能力名を認識しないことを意味し、`unknown`
と区別します。状態には
`reason`、`limits`、`source`（`handshake`、`schema`、`version_profile`、
`configuration`）も含められます。使用前に制限を確認してください。

`CapabilityRequirement` は `name` と任意の `acceptedModes` を持ちます。
`profile.requiredCapabilities` は `connect` が Client を返す前に検証されます。
`acceptedModes` を省略すると `native` のみを許可します。

## HarnessError

捕捉した値は `isHarnessError(error: unknown): error is HarnessError`
で絞り込みます。 `HarnessError` は `Error`
を継承し、`code`、`retryable`、任意の Provider/Profile ID、
`providerCode`、`details` を持ちます。`retryable`
は明示的な診断であり、自動再試行やタスク再実行の安全性の保証ではありません。

| HarnessErrorCode            | 分類                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `provider_not_found`        | 一致する登録済み Provider がありません。                        |
| `profile_invalid`           | 接続 Profile が無効です。                                       |
| `runtime_not_found`         | 必要な Runtime が利用できません。                               |
| `connection_failed`         | 接続または解放処理の失敗。                                      |
| `authentication_failed`     | 認証が拒否されたか利用できません。                              |
| `provider_api_incompatible` | Runtime/プロトコルに互換性がないか、実装を利用できません。      |
| `unsupported_capability`    | 操作または必要な能力を利用できません。                          |
| `invalid_request`           | API 入力が無効です。                                            |
| `session_not_found`         | ネイティブ Session を利用できません。                           |
| `session_provider_mismatch` | Provider、Profile、互換 ID の不一致。                           |
| `run_conflict`              | 実行の競合。                                                    |
| `timeout`                   | 操作の期限超過。                                                |
| `provider_error`            | Provider の失敗。                                               |
| `connection_aborted`        | ネイティブ終端結果なしで Transport/プロセス接続が終了しました。 |

上流の失敗の詳細な対応付けは Adapter が定義します。エラーの構築は
`new HarnessError(code, message, options)` を使い、`options.retryable`
は必須です。任意のフィールドは
`providerId`、`profileId`、`providerCode`、`details`、`cause`
です。メッセージ、詳細、原因は渡す前に秘匿化してください。コンストラクターは任意の値を自動的に秘匿化しません。捕捉したエラー全体ではなく、安全な分類を記録してください。

## Extension と Native Access

`client.extensions()` は `ProviderExtensionRegistry` を返します。

| メソッド                                                       | 戻り値                                   |
| -------------------------------------------------------------- | ---------------------------------------- |
| `list()`                                                       | `readonly ProviderExtensionDescriptor[]` |
| `has(name: string)`                                            | `boolean`                                |
| `get<T>(name: string, guard?: (value: unknown) => value is T)` | `T \| undefined`                         |

記述は `name`、`providerId`、`displayName`、任意の `description`、
`documentationUrl`、`stability`（`stable` または
`experimental`）を含みます。拡張名とメソッドは Provider ガイドで確認してください。拡張がない場合や Guard が失敗した場合は
`undefined` です。型引数だけでは実行時検証を行いません。

`client.native<T = unknown>(guard?: (value: unknown) => value is T)` も
`T | undefined`
を返します。明示的に Provider に依存するアクセスです。どちらの方法もネイティブ状態を移植可能にはしません。

## Adapter 作者向けユーティリティ

以下も `harapter` から公開されます。通常の組み込み設定には不要です。

| エクスポート                                                                        | 用途                                                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `providerId(value)`、`profileId(value)`、`providerSessionId(value)`、`runId(value)` | 前後に空白のない空でない文字列を型付き ID にします。ネイティブ ID は解析しません。                                                 |
| `assertSessionOwnership(ref, expectedProviderId, expectedProfileId)`                | 所有者の不一致を `session_provider_mismatch` で拒否します。                                                                        |
| `assertSessionCompatibility(ref, expectedCompatibilityRef)`                         | 互換フィンガープリントの不一致を `session_provider_mismatch` で拒否します。                                                        |
| `new ExtensionRegistry(ownerProviderId)`                                            | 拡張検索と `register(descriptor, value)` を提供し、冪等な解除関数を返します。所有者の不一致や名前の重複は `invalid_request` です。 |

正確な宣言は [Core のエクスポート](../packages/core/src/index.ts)、
[ID](../packages/core/src/identifiers.ts)、
[所有権チェック](../packages/core/src/ownership.ts)、
[拡張 Registry](../packages/core/src/extensions.ts)を参照してください。高度な SDK サブパスは
[SDK ガイド](../packages/harapter/README.ja.md)にあり、同じ npm パッケージに属します。
