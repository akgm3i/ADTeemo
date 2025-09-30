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
using checkHealthStub = stub(apiClient, "checkHealth", () => Promise.resolve({ success: true, ... }));
await execute(interaction);
```

**なぜ良いのか？**: このテストは`apiClient`の公開インターフェース（`checkHealth`メソッドの仕様）にのみ依存します。`apiClient`の内部実装がどう変わろうと、`checkHealth`メソッドの仕様が守られている限り、このテストは安定してパスし続けます。これにより、リファクタリングへの耐性が高く、メンテナンスしやすいテストが実現できます。

### 具体例1: APIのルートハンドラ

APIルートハンドラのユニットテストです。責務は「リクエストを解釈し、DB操作モジュールを呼び出し、レスポンスを構築する」ことです。DB操作はモックし、ハンドラ自身のロジックに集中して検証します。

```typescript
// api/src/routes/users.test.ts
describe("POST /users", () => {
  describe("正常系", () => {
    test("有効なユーザー名が指定されたとき、dbActions.createUserを呼び出し、作成されたユーザー情報と共に201レスポンスを返す", async () => {
      // Setup: 依存するDB操作モジュールをスタブ化
      using createUserStub = stub(dbActions, "createUser", (name) =>
        Promise.resolve({ id: "user-abc-123", name, createdAt: new Date() })
      );

      // Action: テストクライアントでAPIを呼び出す
      const res = await client.users.$post({ json: { name: "Teemo" } });

      // Assert: レスポンス、呼び出し回数、呼び出し内容を検証
      assertEquals(res.status, 201);
      const body = await res.json();
      assertEquals(body.name, "Teemo");
      assertSpyCalls(createUserStub, 1);
      assertSpyCall(createUserStub, 0, { args: ["Teemo"] });
    });
  });
});
```

### 具体例2: Botのコマンドハンドラ

コマンドハンドラのユニットテストです。依存する`apiClient`や他の内部モジュールをモックし、コマンドハンドラ自身のロジック（入力の解釈、依存先の呼び出し）を検証します。

```typescript
// bot/src/commands/set-main-role.test.ts
describe("/set-main-role command", () => {
  describe("正常系", () => {
    test("有効なロール名が指定されたとき、apiClientとmessagesを呼び出し、成功メッセージで応答する", async () => {
      // Setup: 依存するモジュールをすべてスタブ化
      using setMainRoleStub = stub(apiClient, "setMainRole", () => Promise.resolve({ success: true }));
      using successMessageStub = stub(messages, "success", () => "メインロールをJungleに設定しました。");

      const interaction = new MockInteractionBuilder("set-main-role")
        .withUser({ id: "user-123" })
        .withStringOption("role", "Jungle")
        .build();
      using editReplySpy = spy(interaction, "editReply");

      // Action
      await execute(interaction);

      // Assert: 各モックの呼び出し回数と内容を検証
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
      // Setup: 依存するfetchをスタブ化
      using fetchStub = stub(globalThis, "fetch", () =>
        Promise.resolve(new Response(JSON.stringify({ success: true })))
      );

      // Action
      await apiClient.setMainRole("user-123", "Jungle");

      // Assert: fetchの呼び出し回数と内容を検証
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
    });
  });
});
```

## 1.3. 統合テスト (Integration Tests)

- **目的**: 複数のコンポーネント（`bot`, `api`, `db`）を実際に連携させ、ユーザーの操作から始まる一連のシナリオが正しく動作することを保証します。

- **原則**:
    - **APIのテスト**: `test_client` を使用してAPIリクエストを送信し、レスポンスの内容や、その結果としてデータベースの状態が正しく変更されたかを検証します。
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
      // 1. Setup: Discordからのコマンド実行を模倣
      const interaction = new MockInteractionBuilder("create-custom-game")
        .withStringOption("name", "今夜のカスタム").build();

      // 2. Action: Botのコマンドハンドラを実行（内部のapiClientは実物のAPIを叩く）
      await createCustomGame.execute(interaction);

      // 3. Assert: テスト用DBを直接確認し、イベントが作成されたことを検証
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
