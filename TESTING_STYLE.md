# テストコード スタイルガイド

このドキュメントは ADTeemo のテスト方針を定義します。Deno 2.5 以上、Hono RPC、Drizzle ORM、discord.js を前提にします。

## 1. 基本方針

テストは「仕様を固定するための実行可能なドキュメント」として扱います。新機能・バグ修正では、先に期待する振る舞いを日本語のテスト名で表現し、そのテストを満たす形で実装します。

標準の検証コマンドは次の通りです。

```bash
deno task test:all
```

`test:all` は `.env.example` を読み込み、coverage を出力します。Docker 内で同じ検証を行う場合は次を使います。

```bash
docker compose --profile dev run --rm dev deno task test:all
```

## 2. テスト分類

| 分類            | 対象                                        | 配置                               | 主な依存の扱い                                               |
| --------------- | ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| Unit            | 純粋関数、helper、formatter、ロール管理など | 対象ファイルと同階層の `*.test.ts` | 直接依存のみ stub / spy                                      |
| Hono route      | API route handler                           | `api/src/routes/*.test.ts`         | DB action、Riot API、RSO などを stub                         |
| Bot command     | slash command handler                       | `bot/src/commands/*.test.ts`       | `apiClient`、messages、helper を stub                        |
| API client      | Bot の API 境界                             | `bot/src/api_client.test.ts`       | Hono RPC client または client factory を stub する方針へ移行 |
| DB action       | Drizzle query / transaction                 | 将来 `api/src/db/*.test.ts`        | 一時SQLite DBで隔離                                          |
| Integration     | Bot / API / DB の連携                       | 将来 `tests/integration/`          | Discord / Riot など外部サービスは mock                       |
| Live external   | 実際の Riot API 疎通                        | `api/src/*.live.test.ts`           | 明示 opt-in。通常の `test:all` では skip                     |
| Message catalog | 多言語メッセージ整合性                      | `messages/src/*.test.ts`           | 一時ディレクトリや環境変数を stub                            |

## 3. Deno とテストライブラリ

- BDD構造は `jsr:@std/testing/bdd` の `describe` と `test` を使います。
- アサーションは `@std/assert` を使います。
- stub / spy は `@std/testing/mock` を使い、必ず `using` で自動復元します。
- テスト名は日本語で「状況、操作、期待結果」が分かる形にします。
- `Arrange` / `Act` / `Assert` の3段階をコメントで分けます。
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

### `describe`

`describe` はテスト対象のコンテキストを定義します。APIのエンドポイント、Bot command名、helper名、特定シナリオ名などを置きます。

### `test`

`test` はコンテキスト内の振る舞いを記述します。テスト名は「（条件）のとき、（操作）を行うと、（結果）となる」という形を基本にします。

例:

```typescript
test("Riotアカウントが見つからない場合、Riot ID連携を実行すると、404とエラーメッセージを返す", async () => {
  // ...
});
```

### 正常系と異常系

`describe("正常系", ...)` と `describe("異常系", ...)` でグループ化し、読む側が期待動作と失敗時動作をすぐ追えるようにします。異常系では特に次を検証します。

- 不正な入力: 必須オプション欠如、無効な選択肢、長すぎる文字列など。
- 依存関係のエラー: API、DB、Discord、Riot、RSOがエラーを返すケース。
- 権限不足: Botやユーザーに必要権限がないケース。
- 状態不整合: 存在しないイベント、重複実行、期限切れstateなど。

## 5. モック対象の境界

ユニットテストでは、テスト対象モジュール（SUT: System Under Test）が直接やり取りする依存関係だけを stub / spy します。間接依存の実装詳細を stub すると、SUTの振る舞いが変わっていないリファクタリングでもテストが壊れます。

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

`apiClient` 自体をテストする場合は、`apiClient` から見た直接依存を stub します。現状の一部テストは `globalThis.fetch` に依存していますが、今後は Hono RPC client または client factory を直接 stub できる形へ移行します。

## 6. テストダブルとアサーション

- `stub`: 関数の実装を置き換え、DB・外部API・直接依存の戻り値を制御します。
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
- utility の配置は利用範囲に合わせます。Bot専用なら `bot/src/`、API専用なら `api/src/`、横断的なら将来 `tests/` 配下を検討します。

## 8. 意味のあるアサーション

アサーションは、テスト対象コードの振る舞いを検証するものでなければなりません。単に stub の戻り値がそのまま返ったことだけを見るのではなく、SUTが依存を正しく呼び、レスポンスや副作用を正しい形に組み立てたことを確認します。

動的な値を含む場合でも、曖昧な `startsWith` だけに頼らず、テスト内で固定または取得した動的値を使って完全な期待値を組み立てます。

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
return c.json({ error: "Event not found" }, 404);
return c.body(null, 204);
```

APIレスポンスボディに `success` は含めません。成否はHTTPステータスが唯一のソースです。

- 成功してデータを返す: `200` + 必要最小限のJSON
- 作成: `201`
- 成功して本文不要: `204`
- 非同期受付: `202`
- 入力不正: `400` または `422`
- 対象なし: `404`
- 競合: `409`
- サーバー内部失敗: `500`

エラーボディの基本形:

```json
{ "error": "Event not found" }
```

必要な場合のみ次の形へ拡張します。

```json
{ "code": "EVENT_NOT_FOUND", "error": "Event not found", "details": {} }
```

例: Riot ID 連携 route

```typescript
test("Riotアカウントが見つからない場合、404とエラーメッセージを返す", async () => {
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
  assertEquals(typeof body.error, "string");
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

## 12. Riot API Live Tests

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

Riot API キーは Riot Developer Portal にログインすると Development API Key として発行されます。Development API Key は一時的なキーで、Riot 公式ドキュメント上も 24 時間ごとに無効化されるため、live test 失敗時はまずキー期限を確認してください。Personal / Production Key が必要な運用に移る場合は、Developer Portal でプロダクト登録を行います。

live test の注意点:

- `RIOT_API_KEY` は `.env.example` や Git 管理ファイルに保存しません。
- live test は 401/403、429、Riot API 側障害、対象ユーザーが試合中でない状態に影響されます。
- Spectator-v5 は対象が試合中でない場合 404 相当として `null` を正常扱いします。
- Match-v5 は終了直後に反映遅延があるため、指定 Match ID が取得できない場合は時間を置いて再実行します。

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

Bot 内部の `apiClient` や command 戻り値として `success` を持つ `Result` 型を使うことは許可します。これは UI 層の分岐を扱いやすくするための内部表現であり、HTTP API レスポンス契約とは別物です。

## 12. API Client Tests

`bot/src/api_client.ts` は Bot と Hono RPC API の境界です。現状の一部テストは `globalThis.fetch` を stub していますが、これは Hono client の内部実装に依存しやすいため段階的に廃止します。

今後の方針:

- `hcWithType(API_URL)` を直接 module top-level で固定しすぎない。
- client factory を導入し、API client test では Hono RPC client のメソッドを直接 stub できるようにする。
- HTTPステータスの扱い、JSON body の parse、Bot内部Resultへの変換を `apiClient` の責務として検証する。

許容される内部Result例:

```typescript
type ApiClientResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };
```

ただし、APIサーバーから返るJSONに `success` がある前提のテストを書いてはいけません。

## 13. DB Action Tests

現在の `api/src/db/index.ts` は module-level の `db` singleton を export しています。この構造はユニットテストでは DB action を stub しやすい一方、DB action 自体の統合テストを隔離しにくいです。

今後の設計:

- `createDb(url)` を導入し、テストごとに一時SQLiteファイルまたは一時ディレクトリを使う。
- `createApp({ dbActions })` を導入し、route test はDB実体ではなく注入された action を使う。
- DB action tests は migration または schema push 相当の初期化を行い、テスト後に一時DBを破棄する。
- foreign key、unique制約、transaction、cascade delete はDB action testsで検証する。

DB action 以外の route test では、DB実体に触れず `dbActions` を stub してください。

## 14. Integration Tests

統合テストは、Bot command から API と DB を通じて状態が変わる重要シナリオに限定します。配置は将来 `tests/integration/` を使います。

優先シナリオ:

- Riot ID 連携
- カスタムゲーム作成と募集メッセージ保存
- イベント選択、参加確定、チーム分け
- 戦績記録と内部レート更新

Discord API と Riot API はプロジェクト外部のサービスなので、統合テストでも mock / fake を使います。

## 15. Message Catalog Tests

`messages` workspace は、全言語・全テーマの key 整合性を検証します。

- source of truth は既定テーマの日本語メッセージです。
- 不足キーと重複キーはテストまたは `check:messages` で検出します。
- テーマにキーがない場合は既定テーマへ fallback する挙動を維持します。
- message key の追加・削除時は `messages/ja_JP/system.json`、`messages/ja_JP/teemo.json`、`messages/en_US/system.json` を同時に確認します。

## 16. Coverage と品質

coverage は品質確認の補助指標です。数値だけを目的化せず、仕様上重要な分岐、失敗時のユーザー応答、DB制約、外部API失敗時の扱いを優先してテストします。

変更後の標準確認:

```bash
deno task fmt:check
deno task lint
deno task check
deno task test:all
```

`deno task quality` は上記を一括で実行します。
