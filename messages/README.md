# メッセージ編集ガイド

- Type: content
- Status: current
- Summary: catalog、message key、fallback、表示表現の編集規則。
- Read when: messages/**/*.jsonやformatMessage呼び出しを変更するとき。
- Related: [#36](https://github.com/akgm3i/ADTeemo/issues/36), [#129](https://github.com/akgm3i/ADTeemo/issues/129)
- Code: [catalog](./ja_JP/system.json), [loader](./src/main.ts)
- Tests: [loader tests](./src/main.test.ts), [catalog check](./src/check-messages.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

実際の文言は`messages/<language>/<theme>.json`だけで管理する。日本語system catalogの構造から型付き`messageKeys`を生成し、コードではそのkeyを使用する。Markdownへ全メッセージ本文を写さない。

## 編集

- 意味が同じ通知は同じkeyを使い、入力条件・次の操作が異なる通知は区別する。
- 既存のplaceholder名と置換値の型を呼び出し元で確認する。翻訳・テーマでもplaceholderの意味を変えない。
- systemは操作結果、対象、次にできる操作を簡潔に示す。エラーでは内部APIやDBの詳細を利用者へ出さない。
- commandがまだ提供されていなければ、予定文言を現行操作として案内しない。採用前のフローは[Proposal](../docs/proposals/custom-game-flow.md)、実際に有効なcommandは[registry](../bot/src/common/command_registry.ts)で確認する。
- テーマは情報量と操作の意味を維持し、[Teemo文体ガイド](./TEEMO_STYLE.md)に従う。

## fallbackと検証

テーマ固有keyがなければ言語のsystemへ戻る。既定言語・catalog読込失敗・未知keyを含む正確なfallbackはloaderとtestsが正本であり、文書へ別の実装を複製しない。

追加・削除時は`ja_JP/system.json`、`ja_JP/teemo.json`、`en_US/system.json`を合わせて確認する。`deno task check:messages`で重複・不足・不正catalogを検出し、loader挙動を変える場合は対象testと[テスト方針](../TESTING_STYLE.md)に従って検証する。
