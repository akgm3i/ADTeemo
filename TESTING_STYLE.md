# テストコード スタイルガイド

このドキュメントは、このプロジェクトにおけるテストコードの一貫性を保ち、可読性とメンテナンス性を向上させることを目的としたスタイルガイドです。

# Part 1: テスト戦略

## 1.1. 基本方針

本プロジェクトのテストは、以下の2種類に大別されます。

1.  **ユニットテスト (Unit Tests)**: モジュール単体の機能を検証する。
2.  **統合テスト (Integration Tests)**: 複数のコンポーネントを連携させ、実際のユーザー操作に近いシナリオを検証する。

## 1.2. ユニットテスト (Unit Tests)

- **目的**: モジュール単体（通常は1ファイル）の機能と、そのインターフェース（入力と出力）が仕様通りに動作することを保証します。

- **原則**: テスト対象モジュールが依存する**他のモジュールや外部APIとの境界は、すべてモック**します。これには以下が含まれます。
    - 同じサービス内の他のモジュール（ヘルパー関数、サービスクラスなど）
    - データベース (DB)
    - 他のサービス (例: Botから見たAPIサーバー)
    - 外部APIとの通信（例: `fetch`の呼び出し）

- **配置**: 各サービスディレクトリ（`api/`, `bot/`など）の内部に、テスト対象ファイルと同じ階層に `*.test.ts` として配置します。

### モック対象の境界: 直接の依存関係のみを対象とする

ユニットテストの重要な目的は、テスト対象モジュール（SUT: System Under Test）のロジックを、その依存から隔離して検証することです。これを実現するため、モック（スタブ）はSUTが**直接**やり取りする依存関係（Collaborators）のインターフェースに対してのみ行います。

依存関係の、さらにその先の依存関係（間接的な依存関係）をモックすることは、テストを脆く（Brittle）するため避けるべきです。

#### 具体例: `health`コマンドのテスト

`health`コマンドは、内部で`apiClient`を使ってAPIと通信します。

```
[ health.ts ] ---> [ apiClient.ts ] --(fetch)--> [ API ]
```

##### 悪い例（避けるべきプラクティス）

テスト対象(`health.ts`)の間接的な依存先である`fetch`をモックする。

```typescript
// 悪い例: health.test.ts
import { stub } from "@std/testing/mock";
import { execute } from "./health.ts";

// ...
// apiClientの内部実装であるfetchをスタブしている
using fetchStub = stub(globalThis, "fetch", () => Promise.resolve(/* ... */));
await execute(interaction);
```

**なぜ悪いのか？**: このテストは、`apiClient`が内部で`fetch`を使っているという**実装の詳細**に依存しています。もし`apiClient`がリファクタリングされ、`fetch`の代わりに別のHTTPクライアントを使うようになった場合、`health.ts`のコードは一切変更がないにも関わらず、このテストは失敗してしまいます。

##### 良い例（推奨されるプラクティス）

テスト対象(`health.ts`)の直接の依存先である`apiClient`のメソッドをモックする。

```typescript
// 良い例: health.test.ts
import { stub } from "@std/testing/mock";
import { execute } from "./health.ts";
import { apiClient } from "../api_client.ts"; // 直接の依存先をインポート

// ...
// health.tsの直接の依存先であるapiClient.checkHealthをスタブしている
using checkHealthStub = stub(apiClient, "checkHealth", () => Promise.resolve({ success: true, message: "ok" }));
await execute(interaction);
```

**なぜ良いのか？**: このテストは`apiClient`の公開インターフェース（`checkHealth`メソッドの仕様）にのみ依存します。`apiClient`の内部実装がどう変わろうと、`checkHealth`メソッドの仕様が守られている限り、このテストは安定してパスし続けます。これにより、リファクタリングへの耐性が高く、メンテナンスしやすいテストが実現できます。

### 具体例1: APIのルートハンドラ

APIルートハンドラのユニットテストです。責務は「リクエストを解釈し、DB操作モジュールを呼び出し、レスポンスを構築する」ことです。DB操作はモックし、ハンドラ自身のロジックに集中して検証します。

```typescript
// api/src/routes/users.test.ts
import { z } from "zod";

describe("POST /users", () => {
  describe("正常系", () => {
    test("有効なユーザー名が指定されたとき、dbActions.createUserを呼び出し、201 Createdと作成されたユーザー情報を返す", async () => {
      // Arrange
      using createUserStub = stub(dbActions, "createUser", (name) =>
        Promise.resolve({ id: "user-abc-123", name, createdAt: new Date() })
      );
      const userResponseSchema = z.object({ name: z.string() });

      // Act
      const res = await client.users.$post({ json: { name: "Teemo" } });

      // Assert
      assert(res.status === 201);
      const { name } = userResponseSchema.parse(await res.json());
      assertEquals(name, "Teemo");
      assertSpyCalls(createUserStub, 1);
      assertSpyCall(createUserStub, 0, { args: ["Teemo"] });
    });
  });
});
```

ここで成否判定はHTTPステータスのみで行い、レスポンスボディは`zod`のスキーマで検証しています。API側で`success`フラグを返さない方針でも、型安全にアサーションできる点を示しています。

### 具体例2: Botのコマンドハンドラ

コマンドハンドラのユニットテストです。依存する`apiClient`や他の内部モジュールをモックし、コマンドハンドラ自身のロジック（入力の解釈、依存先の呼び出し）を検証します。

```typescript
// bot/src/commands/set-main-role.test.ts
describe("/set-main-role command", () => {
  describe("正常系", () => {
    test("有効なロール名が指定されたとき、apiClientとmessagesを呼び出し、成功メッセージで応答する", async () => {
      // Arrange
      using setMainRoleStub = stub(apiClient, "setMainRole", () =>
        Promise.resolve({ success: true, error: null })
      );
      using successMessageStub = stub(messages, "success", () => "メインロールをJungleに設定しました。");

      const interaction = new MockInteractionBuilder("set-main-role")
        .withUser({ id: "user-123" })
        .withStringOption("role", "Jungle")
        .build();
      using editReplySpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCalls(setMainRoleStub, 1);
      assertSpyCall(setMainRoleStub, 0, { args: ["user-123", "Jungle"] });
      assertSpyCalls(successMessageStub, 1);
      assertSpyCalls(editReplySpy, 1);
      assertSpyCall(editReplySpy, 0, { args: ["メインロールをJungleに設定しました。"] });
    });
  });
});
```

### 具体例3: BotのAPIクライアント

`apiClient`モジュールのユニットテストです。依存する`fetch`をモックし、`apiClient`の責務である「正しいHTTPリクエストを組み立てて送信すること」を検証します。

```typescript
// bot/src/api_client.test.ts
describe("apiClient.setMainRole", () => {
  describe("正常系", () => {
    test("ユーザーIDとロールが与えられたとき、適切なPUTリクエストをfetchで送信する", async () => {
      // Arrange
      using fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(new Response(null, { status: 204 }))
      );

      // Act
      const result = await apiClient.setMainRole("user-123", "Jungle");

      // Assert
      assertSpyCalls(fetchStub, 1);
      assertSpyCall(fetchStub, 0, {
        args: [
          "https://api.example.com/users/user-123/role",
          {
            method: "PUT",
            body: JSON.stringify({ role: "Jungle" }),
          },
        ],
      });
      assertEquals(result.success, true);
    });
  });
});
```

## 1.3. 統合テスト (Integration Tests)

- **目的**: 複数のコンポーネント（`bot`, `api`, `db`）を実際に連携させ、ユーザーの操作から始まる一連のシナリオが正しく動作することを保証します。

- **原則**:
    - **APIのテスト**: `testClient` を使用してAPIリクエストを送信し、レスポンスの内容や、その結果としてデータベースの状態が正しく変更されたかを検証します。
    - **Botのテスト**: Discordの `interaction` を模倣してコマンドを実行し、Botからの応答メッセージや、API連携を通じてデータベースの状態が正しく変更されたかを検証します。
    - Riot APIやDiscord APIのような、プロジェクト管理外の外部ドメインのサービスは、引き続きモックを使用します。

- **配置**: プロジェクトのルートに `tests/integration/` ディレクトリを作成し、その中に配置します。

### 具体例

Botのコマンド実行から、APIサーバーを経由し、最終的にデータベースのレコードが正しく更新されるか、という一連の流れを検証します。

```typescript
// tests/integration/bot/create_game_scenario.test.ts
describe("シナリオ: カスタムゲーム作成", () => {
  describe("正常系", () => {
    // Suite Setup: このテストスイートの実行前に、テスト用のAPIサーバーとDBをセットアップする
    test("ユーザーがゲーム作成コマンドを実行したとき、APIを通じてDBにイベントが記録される", async () => {
      // Arrange
      const interaction = new MockInteractionBuilder("create-custom-game")
        .withStringOption("name", "今夜のカスタム").build();

      // Act
      await createCustomGame.execute(interaction);

      // Assert
      const eventInDb = await testDb.query.events.findFirst();
      assertExists(eventInDb);
      assertEquals(eventInDb.name, "今夜のカスタム");
    });
  });
});
```

# Part 2: テスト記述の共通規約

## 2.1. テストの構造と命名

### `describe`: コンテキストの定義
`describe`ブロックは、テスト対象のコンテキスト（状況や環境）を定義します。APIのエンドポイント名、コンポーネント名、特定のシナリオ名などが該当します。

### `test`: 振る舞いの記述
`test`ブロックは、`describe`で定義されたコンテキスト内でのシステムの**振る舞い**を記述します。テストケース名は**「（条件）のとき、（操作）を行うと、（結果）となる」** という形式を基本とします。

### 正常系と異常系のグループ化
`describe`をネストさせて`describe("正常系", ...)`と`describe("異常系", ...)`のようにグループ化し、テストの可読性を高めることを強く推奨します。

システムの堅牢性を保証するため、特に異常系のテストを網羅することが重要です。異常系のテストでは、主に以下のような観点を検証します。

- **不正な入力**: ユーザーからの入力値が仕様（型、フォーマット、範囲）を満たさないケース。
  - 例: 必須オプションの欠如、無効な選択肢の指定、長すぎる文字列など。
- **依存関係のエラー**: 依存するモジュールや外部APIがエラーを返すケース。
  - 例: APIクライアントが5xx/4xxエラーを返す、DB操作で制約違反が発生する、ネットワーク接続に失敗するなど。
- **権限不足**: 操作を実行するために必要な権限をユーザーやBotが持っていないケース。
  - 例: 特定のロールを持たないユーザーによるコマンド実行、Discord APIの権限不足など。
- **状態の不整合**: システムが期待される前提状態にないケース。
  - 例: 未作成のオブジェクトを操作しようとする、処理が重複して実行されるなど。

## 2.2. テストダブル (モック、スタブ、スパイ)

ユニットテストでは、`@std/testing/mock`の機能を利用してテストダブルを作成し、依存関係を隔離します。

- **`stub`**: 関数の**実装を完全に置き換える**ために使用します。データベースアクセスや外部API呼び出しを偽の動作に差し替え、結果をコントロールしたい場合に最適です。

- **`spy`**: **元の実装を維持したまま**、関数の呼び出しを監視（スパイ）するために使用します。

- **クリーンアップ**: `using` 構文を使用し、テストダブルのライフサイクルをテストケース内に限定します。これにより、`restore()` の呼び出し忘れを確実に防ぎます。

- **アサーション**: `assertSpyCall`で呼び出し時の引数などを検証するだけでなく、`assertSpyCalls`で**期待される呼び出し回数**も検証することが、意図しない副作用を防ぐ上で重要です。

## 2.3. テストユーティリティ

テストのセットアップ（例: `Interaction`オブジェクトの生成）をDRY（Don't Repeat Yourself）に保つため、繰り返し利用するヘルパー関数やモックビルダーは、`test_utils.ts`のようなファイルにまとめることを推奨します。ユーティリティのスコープに応じて、適切なディレクトリ（例: `bot/src/`や`api/src/`）に配置してください。

## 2.4. テストケースの構造 (Arrange-Act-Assert パターン)

各テストケース (`test` ブロック) は、可読性を高めるために **Arrange-Act-Assert (AAA)** パターンに従って構造化することを強く推奨します。

- **`// Arrange` (準備):** テスト対象の実行に必要な前提条件（データ、スタブ、モックなど）をすべて準備します。
- **`// Act` (実行):** テスト対象のコード（関数やメソッド）を呼び出します。
- **`// Assert` (検証):** 実行結果が期待通りであったかをアサーション関数を使って検証します。

各ブロック間には空行を入れ、`// Arrange`等のコメントで視覚的な区切りを明確にします。

## 2.5. 意味のあるアサーションの原則

テストにおけるアサーションは、テスト対象コードのロジックや振る舞いを検証するものでなければなりません。

### スタブの戻り値の伝搬を検証する場合

スタブした関数の戻り値が、最終的なレスポンスに正しく含まれているかを検証することは、境界間の連携をテストする上で有効です。

ただし、その検証は可能な限り厳密に行うべきです。

```typescript
// Arrange
using getAuthorizationUrlStub = stub(
  rso,
  "getAuthorizationUrl",
  (state: string) => `https://mock.auth.url/authorize?state=${state}`,
);
// ...

// Act
const res = await client.auth.rso["login-url"].$get(...);
const body = await res.json();

// Assert
// 呼び出し回数を検証する
assertSpyCalls(getAuthorizationUrlStub, 1);

// レスポンスボディに含まれるURLの「静的な部分」が完全一致することを検証する
const state = getAuthorizationUrlStub.calls[0].args[0];
assertEquals(body.url, `https://mock.auth.url/authorize?state=${state}`);
```
`startsWith`のような曖昧な比較ではなく、動的な部分（この例では`state`）を含めた完全なURLで比較することで、「余計な文字列が付与されていないか」「URLの形式が意図せず変わっていないか」といった点まで含めて厳密に検証できます。

## 2.6. 予測不可能な値の扱い

テストは常に予測可能であるべきです。テスト対象のコード内で`new Date()`や`crypto.randomUUID()`のような実行するたびに結果が変わる関数が使われている場合、その扱いには注意が必要です。

### 原則: テスト対象が「直接」呼び出す動的関数はスタブ化する

テスト対象のコードが、その内部で**直接** `crypto.randomUUID()` や `new Date()` を呼び出している場合、それらの関数はスタブ化して値を固定するのが最も推奨されるベストプラクティスです。

今回の`auth.ts`の例では、ルートハンドラ内で直接`crypto.randomUUID()`を呼び出しているため、このパターンに該当します。

```typescript
// 良い例: crypto.randomUUID()を直接スタブ化する
// Arrange
const FIXED_UUID = "fixed-uuid-for-test";
using _uuidStub = stub(crypto, "randomUUID", () => FIXED_UUID);
using createAuthStateStub = stub(dbActions, "createAuthState");
using getAuthorizationUrlStub = stub(rso, "getAuthorizationUrl");

// Act
await client.auth.rso["login-url"].$get(...);

// Assert
// 各モジュールが、固定化されたUUIDで呼び出されたことを個別に検証する
assertSpyCall(createAuthStateStub, 0, { args: [FIXED_UUID, "discord-123"] });
assertSpyCall(getAuthorizationUrlStub, 0, { args: [FIXED_UUID] });
```

### 禁止事項: 外部モジュールの実装詳細へのスタブ化

テスト対象が呼び出す**外部モジュール**（例: `someApiSdk`）が、その**内部で** `crypto.randomUUID()` を使用している場合、テストコードから`crypto.randomUUID()`をスタブ化してはいけません。これは「直接の依存関係のみをモックする」という大原則に反し、外部モジュールの実装詳細に依存した脆いテストになるためです。

その場合は、外部モジュール（`someApiSdk`）のメソッド自体をスタブ化し、動的な値を含んだ最終的な戻り値をテスト側で定義してください。
