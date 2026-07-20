# テストコード スタイルガイド

このドキュメントは ADTeemo のテスト方針を定義します。root `.dvmrc` で固定したDeno 2.5.7、Hono RPC、Drizzle ORM、discord.js を前提にします。

## 1. 基本方針

テストは「仕様を固定するための実行可能なドキュメント」として扱います。新機能・バグ修正では、先に期待する振る舞いを日本語のテスト名で表現し、そのテストを満たす形で実装します。

標準の検証コマンドは次の通りです。

```bash
deno task test:all
```

`test:all` は `.env.example` を読み込み、coverage を出力します。Docker 内で同じ検証を行う場合は次を使います。

対象を絞る場合も、秘密情報を含む `.env` ではなく `.env.example` を読むtaskを使います。

```bash
deno task test:target path/to/example.test.ts
```

```bash
docker compose --profile dev run --rm dev deno task test:all
```

## 2. テスト分類

| 分類            | 対象                                        | 配置                               | 主な依存の扱い                                             |
| --------------- | ------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Unit            | 純粋関数、helper、formatter、ロール管理など | 対象ファイルと同階層の `*.test.ts` | 直接依存のみ stub / spy                                    |
| Hono route      | API route handler                           | `api/src/routes/*.test.ts`         | DB action、Riot API、RSO などを stub                       |
| Bot command     | slash command handler                       | `bot/src/commands/*.test.ts`       | `apiClient`、messages、helper を stub                      |
| API client      | Bot の API 境界                             | `bot/src/api_client.test.ts`       | 注入したHono RPC clientの呼び出しをstub / fake             |
| DB action       | Drizzle query / transaction                 | `api/src/db/actions.test.ts`       | `createDb` で接続先を分離し、一時SQLite DBまたはfakeを使用 |
| Integration     | Bot / API / DB の連携                       | 将来 `tests/integration/`          | Discord / Riot など外部サービスは mock                     |
| Live external   | 実際の Riot API 疎通                        | `api/src/*.live.test.ts`           | 明示 opt-in。通常の `test:all` では skip                   |
| Message catalog | 多言語メッセージ整合性                      | `messages/src/*.test.ts`           | 一時ディレクトリや環境変数を stub                          |

## 3. Deno とテストライブラリ

- BDD 構造は `@std/testing/bdd` の `describe` と `test` を使います。依存元の `jsr:` 指定はworkspaceの `deno.json` に集約します。
- アサーションは `@std/assert` を使います。
- stub / spy は `@std/testing/mock` を使い、必ず `using` で自動復元します。
- テスト名は日本語で「状況、操作、期待結果」が分かる形にします。
- `Arrange` / `Act` / `Assert` の 3 段階をコメントで分けます。
- 動的な値（`crypto.randomUUID()`、現在時刻など）をテスト対象が直接呼ぶ場合は、その直接呼び出しを stub して固定します。

例:

```typescript
describe("GET /rso/login-url", () => {
  describe("正常系", () => {
    test("有効なdiscordIdが提供されたとき、認証用のstateを保存し、認証URLを返す", async () => {
      // Arrange
      const fixedUuid = "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0";
      using _uuidStub = stub(crypto, "randomUUID", () => fixedUuid);

      // Act
      // ...

      // Assert
      // ...
    });
  });
});
```

## 4. テスト構造と命名

`describe` はテスト対象のコンテキストを定義します。API のエンドポイント、Bot command 名、helper 名、特定シナリオ名などを置きます。

`test` はコンテキスト内の振る舞いを記述します。テスト名は「（条件）のとき、（操作）を行うと、（結果）となる」という形を基本にします。

例:

```typescript
test("Riotアカウントが見つからない場合、Riot ID連携を実行すると、404とエラーメッセージを返す", async () => {
  // ...
});
```

正常系と異常系は `describe("正常系", ...)` と `describe("異常系", ...)` でグループ化します。異常系では特に次を検証します。

- 不正な入力: 必須オプション欠如、無効な選択肢、長すぎる文字列など。
- 依存関係のエラー: API、DB、Discord、Riot、RSO がエラーを返すケース。
- 権限不足: Bot やユーザーに必要権限がないケース。
- 状態不整合: 存在しないイベント、重複実行、期限切れ state など。

## 5. モック対象の境界

ユニットテストでは、テスト対象モジュール（SUT: System Under Test）が直接やり取りする依存関係だけを stub / spy します。間接依存の実装詳細を stub すると、SUT の振る舞いが変わっていないリファクタリングでもテストが壊れます。

例: `health` command の依存関係

```text
[ health.ts ] ---> [ apiClient.ts ] --(fetch)--> [ API ]
```

command test で stub するべきなのは `apiClient.checkHealth` です。`apiClient` の内部実装である `globalThis.fetch` は command test から stub しません。

```typescript
using checkHealthStub = stub(
  apiClient,
  "checkHealth",
  () => Promise.resolve({ success: true as const, message: "ok" }),
);

await execute(interaction);

assertSpyCall(checkHealthStub, 0);
```

`apiClient` 自体をテストする場合は、`apiClient` から見た直接依存である注入済みHono RPC clientをstub / fakeします。`globalThis.fetch` はHono clientの内部実装なので、API client testやcommand testから直接stubしません。

## 6. テストダブルとアサーション

- `stub`: 関数の実装を置き換え、DB・外部 API・直接依存の戻り値を制御します。
- `spy`: 元の実装を維持したまま、呼び出しを監視します。
- `using`: stub / spy のライフサイクルをテストケース内に限定し、復元漏れを防ぎます。
- `assertSpyCalls`: 期待する呼び出し回数を検証します。
- `assertSpyCall`: 呼び出し時の引数を検証します。

呼び出し回数の検証は、副作用の重複や意図しない依存呼び出しを検出するために重要です。

```typescript
using setMainRoleStub = stub(
  apiClient,
  "setMainRole",
  () => Promise.resolve({ success: true as const }),
);

await execute(interaction);

assertSpyCalls(setMainRoleStub, 1);
assertSpyCall(setMainRoleStub, 0, {
  args: ["user-123", "mock-guild-id", "Jungle"],
});
```

## 7. テストユーティリティ

Interaction、Guild、Message、DB seed などの繰り返しセットアップは helper や builder にまとめます。

- Bot command の interaction 生成は `bot/src/test_utils.ts` の builder を優先します。
- helper はテストを読みやすくするために使い、検証したい振る舞いを隠しすぎないようにします。
- utility の配置は利用範囲に合わせます。Bot 専用なら `bot/src/`、API 専用なら `api/src/`、横断的なら将来 `tests/` 配下を検討します。

## 8. 意味のあるアサーション

アサーションは、テスト対象コードの振る舞いを検証するものでなければなりません。単に stub の戻り値がそのまま返ったことだけを見るのではなく、SUT が依存を正しく呼び、レスポンスや副作用を正しい形に組み立てたことを確認します。

動的な値を含む場合でも、曖昧な `startsWith` だけに頼らず、テスト内で固定または取得した動的値を使って完全な期待値を組み立てます。

例:

```typescript
const fixedUuid = "a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0";
using _uuidStub = stub(crypto, "randomUUID", () => fixedUuid);
using getAuthorizationUrlStub = stub(
  rso,
  "getAuthorizationUrl",
  (state: string) => `https://mock.auth.url/authorize?state=${state}`,
);

const res = await client.auth.rso["login-url"].$get({
  query: { discordId: "discord-123" },
});
const body = await res.json();

assertEquals(
  body.url,
  `https://mock.auth.url/authorize?state=${fixedUuid}`,
);
assertSpyCall(getAuthorizationUrlStub, 0, { args: [fixedUuid] });
```

## 9. 予測不可能な値の扱い

テスト対象が直接 `crypto.randomUUID()` や現在時刻を呼ぶ場合、その直接呼び出しを stub して固定します。これにより、テストが実行時刻や乱数に依存しなくなります。

一方、テスト対象が呼ぶ外部モジュールの内部で動的関数が使われている場合、その内部実装をテスト側から stub してはいけません。その場合は外部モジュールの公開メソッド自体を stub し、戻り値として動的値を含む結果を定義します。

## 10. Hono Route Tests

Route test は `testClient(app)` または `app.request()` を使います。Hono RPC の型推論を安定させるため、ハンドラ側ではステータスを明示します。

```typescript
return c.json({ events }, 200);
return apiErrorResponse(c, "EVENT_NOT_FOUND");
return c.body(null, 204);
```

API レスポンスボディに `success` は含めません。成否は HTTP ステータスが唯一のソースです。

- 成功してデータを返す: `200` + 必要最小限の JSON
- 作成: `201`
- 成功して本文不要: `204`
- 非同期受付: `202`
- malformed JSONまたはrequest全体の前提違反: `400`
- schema不一致: `422`
- 未認証 / 権限不足: `401` / `403`
- 対象なし: `404`
- 競合: `409`
- rate limit: `429`
- サーバー内部失敗: `500`
- upstream失敗: `502`

エラーボディは [APIエラー契約](./docs/api-error-contract.md) の共通形式を使います。

```json
{ "code": "EVENT_NOT_FOUND", "message": "Event not found" }
```

schema不一致の場合だけ、安全なvalidation issueを `details` に含めます。

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "issues": [{ "code": "invalid_type", "path": ["name"] }]
  }
}
```

例:

```typescript
test("Riotアカウントが見つからない場合、Riot ID連携を実行すると、404とエラーメッセージを返す", async () => {
  // Arrange
  using _riotStub = stub(
    riotApi,
    "getAccountByRiotId",
    () => Promise.resolve(null),
  );
  const client = testClient(app);

  // Act
  const res = await client.users["link-by-riot-id"].$patch({
    json: {
      discordId: "discord-123",
      gameName: "Unknown",
      tagLine: "JP1",
    },
  });

  // Assert
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.code, "RIOT_ACCOUNT_NOT_FOUND");
  assertEquals(typeof body.message, "string");
  assertFalse("success" in body);
});
```

## 11. Bot Command Tests

Bot command のユニットテストは、Discord interaction の入力解釈、直接依存の呼び出し、ユーザーへの応答を検証します。

原則:

- command handler から見た直接依存だけを stub します。
- `apiClient` の内部実装である `fetch` を command test から stub しません。
- `messageHandler.formatMessage` は必要に応じて stub し、どの message key を使ったかを検証します。
- guild 専用コマンドは DM 実行時のエラーも検証します。

例:

```typescript
test("API呼び出しが成功した時にメインロールを設定すると、成功メッセージで応答する", async () => {
  // Arrange
  using setMainRoleStub = stub(
    apiClient,
    "setMainRole",
    () => Promise.resolve({ success: true as const }),
  );
  const interaction = new MockInteractionBuilder("set-main-role")
    .withUser({ id: "user-123" })
    .withStringOption("role", "Jungle")
    .build();

  // Act
  await execute(interaction);

  // Assert
  assertSpyCall(setMainRoleStub, 0, {
    args: ["user-123", "mock-guild-id", "Jungle"],
  });
});
```

## 12. API Client Tests

`bot/src/api_client.ts` は Bot と Hono RPC API の境界です。`createApiClient({ rpcClient })` と `createApiResourceClients({ rpcClient })` がRPC clientを受け取り、`bot/src/main.ts` のcomposition rootで `hcWithType(API_URL)` を組み立てます。

API client testでは注入したRPC clientのfakeを使い、HTTP status、JSON bodyのparse、日時変換、通信失敗、Bot内部Resultへの変換を検証します。`globalThis.fetch` はHono clientの内部実装なので、API client testから直接stubしません。

許容される内部 Result 例:

```typescript
type ApiClientResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };
```

ただし、API サーバーから返る JSON に `success` がある前提のテストを書いてはいけません。

## 13. DB Action Tests

`api/src/db/index.ts` の `createDb({ url, logger })` はDB接続、Drizzle DB、`close` を返します。`createDbActions(db, config)` は接続と設定を引数で受け取り、default connection / actionsはcomposition rootで生成されます。

`api/src/db/actions.test.ts` では、`file::memory:` の接続をテストごとに生成して接続先の分離を検証し、transactionの順序やTTLなどDB action固有の分岐にはfake transactionも使います。実DBを使うテストでは接続を終了し、テスト間で状態を共有しません。

route testでは `createApp({ dbActions })` へテスト用actionを注入し、DB action自体を検証する場合以外はDB実体へ触れません。

DB action 以外の route test では、DB 実体に触れず `dbActions` を stub してください。

## 14. Riot API Live Tests

通常の `deno task test:all` は外部サービスへ接続しない安定したテストとして維持します。実際の Riot API を使う確認は、明示的に次を実行します。

```bash
RIOT_API_KEY="RGAPI-..." \
RIOT_LIVE_TEST_RIOT_ID="GameName#TagLine" \
RIOT_LIVE_TEST_PLATFORM="jp1" \
RIOT_LIVE_TEST_REGION="asia" \
deno task test:riot-live
```

Match-v5 まで確認する場合は、直近の Match ID も渡します。

```bash
RIOT_LIVE_TEST_MATCH_ID="JP1_123456789" deno task test:riot-live
```

live test の注意点:

- `RIOT_API_KEY` は `.env.example` や Git 管理ファイルに保存しません。
- Riot Development API Key は 24 時間ごとに無効化されるため、401/403 時はまずキー期限を確認します。
- live test は 429、Riot API 側障害、対象ユーザーが試合中でない状態に影響されます。
- Spectator-v5 は対象が試合中でない場合 404 相当として `null` を正常扱いします。
- Match-v5 は終了直後に反映遅延があるため、指定 Match ID が取得できない場合は時間を置いて再実行します。

## 15. Integration Tests

統合テストは、Bot command から API と DB を通じて状態が変わる重要シナリオに限定します。配置は将来 `tests/integration/` を使います。

優先シナリオ:

- Riot ID 連携
- カスタムゲーム作成と募集メッセージ保存
- イベント選択、参加確定、チーム分け
- 戦績記録と内部レート更新

Discord API と Riot API はプロジェクト外部のサービスなので、統合テストでも mock / fake を使います。

## 16. Message Catalog Tests

`messages` workspace は、全言語・全テーマの key 整合性を検証します。

- source of truth は既定テーマの日本語メッセージです。
- 不足キーと重複キーはテストまたは `check:messages` で検出します。
- テーマにキーがない場合は既定テーマへ fallback する挙動を維持します。
- message key の追加・削除時は `messages/ja_JP/system.json`、`messages/ja_JP/teemo.json`、`messages/en_US/system.json` を同時に確認します。

## 17. Coverage と品質

coverage は品質確認の補助指標です。数値だけを目的化せず、仕様上重要な分岐、失敗時のユーザー応答、DB 制約、外部 API 失敗時の扱いを優先してテストします。

コード変更後の標準確認は、root `deno.json` のtask定義を正とした `quality` です。

```bash
deno task quality
```

`quality` にはformat、lint、型チェック、Bot runtime境界、メッセージ定義、runtime version同期確認、全テストが含まれます。Pull Requestと`main`へのpushでも固定job名`quality`がこのtaskを実行します。CIではlive external testやrepository secretを使用しません。ドキュメントだけを変更した場合は、対象文書のformat、相対リンク、`git diff --check` など変更に比例した確認を行います。
