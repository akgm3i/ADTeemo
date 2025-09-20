# テストコード スタイルガイド

このドキュメントは、このプロジェクトにおけるテストコードの一貫性を保ち、可読性とメンテナンス性を向上させることを目的としたスタイルガイドです。

## 1. 命名規則と構造 (Naming Conventions and Structure)

### `describe` ブロック
- **階層:** テスト対象のファイルや関数、APIエンドポイントを記述します。ネストが深くなりすぎる場合（4階層以上など）は、テスト対象の設計が複雑すぎる可能性を示唆しているため、リファクタリングを検討します。
- **正常系・異常系の分離:** `describe` を使用して、「正常系」と「異常系」のテストを明確にグループ分けします。

```typescript
// 良い例
describe("routes/events.ts", () => {
  describe("POST /events", () => {
    describe("正常系", () => {
      it("...", () => { /* ... */ });
    });
    describe("異常系", () => {
      it("...", () => { /* ... */ });
    });
  });
});
```

### `it` ブロック (テストケース名)
- **語順:** **「（条件）のとき、（操作）を行うと、（結果）となる」** の語順で、システムの振る舞いを記述します。
- **良い例:** `it("有効なイベントデータが指定されたとき、イベントが作成され成功レスポンスを返す", ...)`
- **悪い例:** `it("有効なイベントデータが指定されたとき、DB作成処理を呼び出し、成功レスポンスを返す", ...)` (内部実装に言及している)

## 2. テストファイルの構成 (Test File Structure)

ユニットテストとインテグレーションテストを明確に分離するため、以下の構成を採用します。

### ユニットテスト (Unit Tests)
- **目的:** 単一の機能（例: ルートハンドラ）を、依存関係から切り離してテストする。
- **ルール:** データベース等の外部依存は**必ずモック**します。
- **ファイル配置:** テスト対象のファイルと同じ階層に `*.test.ts` という名前で配置します。 (例: `events.ts` と `events.test.ts`)

### インテグレーションテスト (Integration Tests)
- **目的:** データベースとの連携など、複数のコンポーネントを組み合わせた動作をテストする。
- **ルール:** テスト用の実データベースに接続して動作を検証する。
- **ファイル配置:** `/api/integration_tests/` ディレクトリ内に、テスト対象の機能名で `*.test.ts` という名前で配置します。 (例: `api/integration_tests/db_actions.test.ts`)

## 3. モックとスタブ (Mocks and Stubs)

`@std/testing/mock` の `stub` と `spy` を、目的に応じて明確に使い分けます。

- **`stub`**: 関数の**実装を完全に置き換える**ために使用します。ユニットテストで、データベースアクセスや外部API呼び出しを偽の動作に差し替え、結果をコントロールしたい場合に最適です。
- **`spy`**: **元の実装を維持したまま**、関数の呼び出しを監視（スパイ）するために使用します。
- **クリーンアップ**: `using` 構文を使用し、スタブのライフサイクルをテストケース内に限定します。これにより、`restore()` の呼び出し忘れを防ぎます。

```typescript
// usingを使ったスタブの例
it("...", async () => {
  using dbStub = stub(dbActions, "someAction", () => Promise.resolve(/* mock data */));
  // ...テストロジック
}); // 'using' により、このブロックを抜けるときに自動で restore() される
```

## 4. テスト実装パターン

### ルートハンドラのテスト (Hono Route Handler)
- これは**ユニットテスト**として扱います。
- **HTTPリクエスト**: Honoの `testClient` を第一選択とします。
- **アサーション**: `res.ok` をアサートした後に `res.json()` を呼び出すことで、型安全性を高めます。

```typescript
// 良い例
const res = await client.events["by-creator"][":creatorId"].$get({
  param: { creatorId: "test-creator" },
});

assert(res.ok); // 先にアサートする
const body = await res.json();

assertEquals(body.success, true);
assertEquals(body.events?.length, 1); // bodyのプロパティに安全にアクセスできる
```

### データベースアクションのテスト
- これは**インテグレーションテスト**として扱います。
- **フック**: `beforeEach` でデータを準備し、`afterEach` でクリーンアップするサイクルを徹底し、テストの独立性を担保します。

```typescript
// 良い例
describe("dbActions.someFunction", () => {
  afterEach(async () => {
    await db.delete(testTable); // テストケースごとにデータをクリーンアップ
  });

  it("...", async () => {
    // Setup: このテストケースに必要なデータだけを挿入
    await db.insert(testTable).values(...);
    // ...テストの実行と検証
  });
});
```

## 5. トラブルシューティング

### Drizzle ORMのスタブで型エラーが発生する場合

**問題:**
`drizzle-orm/libsql` ドライバを使用しているにもかかわらず、Denoの型チェッカーが `drizzle-orm/sqlite-core` の型を推論し、`Promise<ResultSet>` のような型を期待することがあります。この `ResultSet` 型は公開エクスポートされていないため、インポートして使用することができず、解決が困難な型エラーが発生します。

**解決策:**
`any` や `deno-lint-ignore` に頼らず、**構造的型付け**を利用してこの問題を解決します。型チェッカーが期待するオブジェクトの構造を模倣した、完全なモックオブジェクトをスタブの戻り値として提供します。

```typescript
// users.test.ts で発生した setMainRole のスタブエラーの解決例
using setMainRoleStub = stub(
  dbActions,
  "setMainRole",
  () =>
    Promise.resolve({
      // ResultSetが持つプロパティをすべて模倣する
      rows: [],
      columns: [],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      columnTypes: [],
      toJSON: () => ({}),
    }),
);
```
このアプローチにより、型安全性を損なうことなく、型チェッカーを満足させることができます。

## 6. BOT側テスト実装パターン (BOT Test Implementation Patterns)

BOT側のテストは、discord.jsの複雑なオブジェクトを扱うため、API側とは異なるアプローチが必要です。

### 6.1. 依存関係の注入 (`testable` オブジェクト)

BOT側のコード（特にコマンド）は、`apiClient`や`formatMessage`など、複数のモジュールに依存します。これらの依存関係をテストから分離するため、**`testable`オブジェクト**パターンを使用します。

- **目的:** ユニットテストの分離性を高め、テスト対象のコードがどの外部関数を呼び出すかを明確にする。
- **ルール:**
  1. テスト対象のファイル（例: `health.ts`）で、外部依存モジュールをインポートします。
  2. これらの依存関係をまとめた `testable` オブジェクトを `export` します。
  3. ファイル内部では、直接インポートした関数ではなく、`testable` オブジェクト経由で関数を呼び出します。
- **これにより、テストファイル側では `testable` オブジェクトをインポートし、そのプロパティを `stub` や `spy` で差し替えるだけで、簡単に関数の振る舞いを制御できます。**

```typescript
// /bot/src/commands/health.ts
import { apiClient } from "../api_client.ts";
import { formatMessage } from "../messages.ts";

// Exported for testing purposes
export const testable = {
  apiClient,
  formatMessage,
};

export async function execute(interaction: CommandInteraction) {
  // ...
  const result = await testable.apiClient.checkHealth(); // apiClient.checkHealth() ではなく
  // ...
}
```

```typescript
// /bot/src/commands/health.test.ts
import { execute, testable } from "./health.ts";

it("...", async () => {
  // `testable` オブジェクトのメソッドをスタブ化
  using setMainRoleStub = stub(
    testable.apiClient,
    "setMainRole",
    () => Promise.resolve({ success: true, error: null }),
  );
  // ...
});
```

### 6.2. discord.js オブジェクトのモック (`Mock Builders`)

`Interaction` や `Guild` のような `discord.js` のオブジェクトは非常に複雑です。これらをテストごとに手動で作成するのは冗長で、型エラーの原因にもなります。

- **目的:** `discord.js` オブジェクトのモック生成を簡潔かつ型安全に行う。
- **ルール:** `bot/src/test_utils.ts` にある `MockInteractionBuilder` や `MockGuildBuilder` を使用します。
- **特徴:**
  - `with...` メソッドをチェインすることで、宣言的にモックオブジェクトを構築できます。
  - `build()` メソッドが、テストに必要なプロパティを備えたモックオブジェクトを返します。
  - `as unknown as ...` のような危険な型キャストをテストコードから排除します。

```typescript
// 良い例
import { MockInteractionBuilder, MockGuildBuilder } from "../test_utils.ts";

const mockGuild = new MockGuildBuilder()
  .withScheduledEvent({ id: "event-1", status: GuildScheduledEventStatus.Scheduled })
  .build();

const interaction = new MockInteractionBuilder("my-command")
  .withUser({ id: "user-123" })
  .withGuild(mockGuild)
  .withStringOption("option-name", "value")
  .build();
```

### 6.3. アサーションの原則

- **何をテストするか:** コマンドの `execute` 関数のテストは、**個々のヘルパー関数の実装を再テストするのではなく、それらが正しく連携しているか（オーケストレーション）** を検証することに主眼を置きます。
- **メッセージ内容のテスト:**
  - `formatMessage` が生成した最終的な文字列を `assertEquals` で比較するのは、些細な文言修正でテストが壊れるため**避けるべき**です。
  - 代わりに、`testable.formatMessage` を**スタブ化**して固定の文字列を返させ、`interaction.reply` や `editReply` がその固定文字列で呼び出されたことを検証します。
  - 同時に、`formatMessage` のスタブが、**期待された `messageKey` とパラメータで呼び出されたか**を `assertSpyCall` で検証します。これにより、テストがより堅牢になります。

```typescript
// 良い例
it("...", async () => {
  // formatMessage をスタブ化し、常に同じ文字列を返すようにする
  using formatSpy = stub(testable, "formatMessage", () => "mocked message");
  using replySpy = spy(interaction, "reply");

  await execute(interaction);

  // 1. reply が、スタブが返した固定文字列で呼び出されたことを検証
  assertSpyCall(replySpy, 0, {
    args: [{ content: "mocked message", flags: MessageFlags.Ephemeral }],
  });

  // 2. formatMessage が、正しいキーと引数で呼び出されたことを検証
  assertSpyCall(formatSpy, 0, {
    args: [messageKeys.some.message.key, { some: "param" }],
  });
});
```

### 6.4. コンポーネント（ボタン、メニュー）のテスト

`ActionRowBuilder` のようなコンポーネントビルダーは、内部状態を直接プロパティとして持っていません。

- **ルール:** コンポーネントの内容を検証する際は、`.toJSON()` メソッドを使用し、シリアライズされたJSONオブジェクトに対してアサーションを行います。

```typescript
// 良い例
const replyOptions = editSpy.calls[0].args[0] as InteractionEditReplyOptions;
const row = replyOptions.components![0] as ActionRowBuilder<StringSelectMenuBuilder>;
const selectMenu = row.components[0];

const menuJSON = selectMenu.toJSON(); // .toJSON() を呼び出す
assertEquals(menuJSON.options?.length, 1);
assertEquals(menuJSON.options?.[0].label, "Active Event");
```
