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

`@std/testing/mock` の `stub` と `spy` を、目的応じて明確に使い分けます。

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
