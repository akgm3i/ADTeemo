# docs/TASKS.md — ADTeemo Roadmap Checklist

このファイルは Codex が進捗管理しやすいよう、実装順に並べたチェックリストです。完了したタスクは `[x]` に更新してください。

1. [x] `bot/src/commands/create-custom-game.ts`: `deferReply` 後に `reply` を再度呼び出しているパスを修正し、常に `editReply`/`followUp` を用いる。
2. [x] `api/src/routes/users.ts` + `api/src/db/actions.ts`: Riot ID 連携時にユーザーを確実に永続化するため `upsertUser` を組み込み、未登録でも 204 を返さないようにする。
3. [ ] 共通ロガーを導入し、API・Bot の主要エントリポイントから構造化ログを出力する（例: `api/src/app.ts`, `bot/src/main.ts`）。
4. [ ] CI 要件定義を実施し、GitHub Actions で実行すべき検証（lint/fmt/check/test・デプロイ連携など）とトリガー条件を整理する。
5. [ ] GitHub Actions を設定し、`deno lint`/`deno fmt --check`/`deno check`/テストを実行する CI ワークフロー（例: `.github/workflows/ci.yml`）を追加する。
6. [x] `api/src/db/schema.ts` 等を拡張し、`custom_game_events` などに `guild_id` を追加。ユーザーと Riot ID の関連はギルド間で共通しているので、正規化する。
7. [ ] ギルド固有設定テーブル（募集チャンネル、VC、ロールID など）と対応する API を設計・実装し、Bot 側で参照できるようにする。
8. [ ] `api/src/db/actions.ts`/`custom_game_events` に募集メッセージのチャンネルIDを保存し、`bot/src/commands/split-teams.ts` から利用する。
9. [ ] `bot/src/features/role-management.ts`: Bot がギルド参加時に必要ロールを自動作成または検出し、ID を保存するロジックを追加する。
10. [ ] `bot/src/messages.ts` 経由で投稿する募集メッセージをロールIDメンションに対応させる（`@Custom` の文字列依存を解消）。
11. [ ] `api/src/routes/matches.ts` などに試合レコード作成 API を追加し、`/record-match` 実行時に `matches` と `matchParticipants` が正しく紐付くようにする。
12. [ ] `/start-matching` コマンド（Bot 側）を実装し、参加者不足・過多の通知、参加確定、開始状態遷移を行う。
13. [ ] `/split-teams` 実行時に Red/Blue VC が無い場合、自動作成する。自動作成前に管理者へ確認するフローも実装する。
14. [ ] `/my-stats`・`/next-game`・`/rematch` など SPEC 記載の追加コマンドを実装する。
15. [ ] Riot API 連携でゲーム開始検知・戦績取得・内部レート更新を自動化する（`bot/src/features/match_tracking.ts` など）。
16. [ ] Discord/Riot API 呼び出しに対するリクエストキューや指数バックオフ等のレート制限対策を導入する。
17. [ ] `bot/src/api_client.test.ts` ほかのユニットテストで、`globalThis.fetch` のスタブをやめ `client.users["link-by-riot-id"].$patch` など直接依存をスタブする（方法1）。
18. [ ] チーム分け時の戦力均等化ロジックと内部レート計算式を仕様に合わせて高度化する。
19. [ ] Web サイトの要件定義を実施し、主要ユースケース・API 連携要件を整理する。
20. [ ] 上記要件に基づき Web UI（管理者・参加者向け）を実装する。
21. [x] API 応答に含まれている `success` フラグを整理し、HTTP ステータスコードだけで成否を判定できるよう統一する方針を設計・実装する。
