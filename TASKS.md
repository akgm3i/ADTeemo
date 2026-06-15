# TASKS.md — ADTeemo Roadmap Checklist

このファイルは ADTeemo の未実装・改善作業を追跡する正規のチェックリストです。完了したタスクは `[x]` に更新してください。

## 1. 完了済みの基盤修正

1. [x] `bot/src/commands/create-custom-game.ts`: `deferReply` 後に `reply` を再度呼び出しているパスを修正し、常に `editReply`/`followUp` を用いる。
2. [x] `api/src/routes/users.ts` + `api/src/db/actions.ts`: Riot ID 連携時にユーザーを確実に永続化するため、未登録ユーザーでも連携できるようにする。
3. [x] ロガーを導入し、API・Bot の主要エントリポイントからそれぞれ構造化ログを出力する（例: `api/src/app.ts`, `bot/src/main.ts`）。
4. [x] `api/src/db/schema.ts` 等を拡張し、ギルド別ユーザープロファイルと `custom_game_events.guild_id` を導入する。
5. [x] messages で使用する言語・テーマを環境変数から設定できるようにする。
6. [x] Bot がギルド参加時または `/setup-roles` 実行時に必要ロールを検出・作成できるようにする。
7. [x] API レスポンスボディから既知の `success` フラグを削除し、`auth.ts` のエラー応答もHTTPステータスと `{ error }` に統一する。

## 2. 開発体験・CI・テスト基盤

8. [x] `AGENTS.md` / `SPEC.md` / `TASKS.md` / `TESTING_STYLE.md` を現行方針に合わせて刷新し、進捗管理先を `TASKS.md` に統一する。
9. [x] `deno.json` に `fmt:check` / `lint` / `check` / `test:all` / `quality` タスクを追加し、`test:all` が `.env.example` と coverage を既定で使うようにする。
10. [ ] CI 要件定義を実施し、GitHub Actions で実行すべき検証（fmt check / lint / check / test / deploy 連携など）とトリガー条件を整理する。
11. [ ] GitHub Actions を設定し、`deno task quality` を実行する CI ワークフロー（例: `.github/workflows/ci.yml`）を追加する。
12. [ ] Docker 内テストの標準コマンドを検証し、必要に応じて `docker compose --profile dev run --rm dev deno task test:all` をCIまたはREADMEに組み込む。
13. [ ] `api/src/db/index.ts` の module-level `db` singleton を段階的に解消し、`createDb(url)` と `createApp({ dbActions })` を導入してDB action testsを一時SQLiteファイルで隔離できるようにする。
14. [ ] DB factory 導入後、`deno task test:all` の `--allow-sys` / `--allow-ffi` 権限を縮小できるか確認する。
15. [ ] `bot/src/api_client.test.ts` ほかのユニットテストで、`globalThis.fetch` のスタブを段階的にやめ、Hono RPC client または client factory の直接依存をスタブする。

## 3. API・DB設計

16. [ ] `users.riotId` が Riot PUUID を保存している現状を整理し、カラム名またはモデル名を `riotPuuid` 等に改める方針を決める。
17. [x] Riot アカウント情報を `users` から専用テーブルへ正規化し、DiscordユーザーとRiotアカウントの関連を明確にする。
18. [ ] `matches` はグローバル戦績として維持しつつ、開催元の `guild_id` または `custom_game_event_id` を参照できるようにする。
19. [ ] ギルド固有設定テーブル（募集チャンネル、Lobby/Red/Blue VC、ロールID、イベント操作権限など）を設計・実装する。
20. [ ] ギルド設定を取得・更新する API を追加し、Bot 側から参照できるようにする。
21. [x] DBスキーマ変更に対応する Drizzle migration を生成・適用できる状態にする。
22. [ ] `api/src/routes/matches.ts` などに試合レコード作成 API を追加し、`/record-match` 実行時に `matches` と `matchParticipants` が正しく紐付くようにする。
23. [ ] API エラー形式を `{ error: string }` 基本形、必要時 `{ code, error, details }` に統一し、全ルートのテストで `success` が含まれないことを必要箇所で検証する。

## 4. ギルド設定・ロール管理

24. [ ] 自動作成または検出した Discord ロールIDをギルド設定として永続化する。
25. [ ] `/setup-roles` をギルド設定の再同期コマンドとして扱い、既存ロールのID更新と不足ロール作成を同時に行えるようにする。
26. [ ] `bot/src/messages.ts` 経由で投稿する募集メッセージをロールIDメンションに対応させ、`@Custom` の文字列依存を解消する。
27. [ ] `bot/src/features/role-management.ts` のテストを、ID永続化・再同期・権限不足まで含めて拡張する。

## 5. カスタムゲームイベント運営

28. [ ] `custom_game_events` に募集メッセージのチャンネルIDを保存し、`bot/src/commands/split-teams.ts` から利用する。
29. [ ] `/split-teams` で今日開始のイベントを取得するのではなく、作成済みイベントの中から対象を指定・選択できるようにする。
30. [ ] `/start-matching` コマンド（Bot 側）を実装し、参加者不足・過多の通知、参加確定、開始状態遷移を行う。
31. [ ] `/start-event` を作成し、特定イベントを開始するコマンドを実装する。
32. [ ] `/start-matching`、`/split-teams`、キャンセル、再マッチングなどを Message Components 上のボタンから段階的に実行できるようにする。
33. [ ] `/split-teams` 実行時に Red/Blue VC が無い場合、自動作成する。自動作成前に管理者へ確認するフローも実装する。
34. [ ] コマンド全体の構造を見直し、サブコマンド化またはイベント中心フローへの段階移行を設計する。

## 6. 戦績・レート・Riot API連携

35. [ ] `/record-match` コマンドの戦績入力を簡易化する。Message Components や Modal Components を使用する。
36. [ ] Riot API 連携でゲーム開始検知・戦績取得・内部レート更新を自動化する（`bot/src/features/match_tracking.ts` など）。
    - [x] `riot_accounts` を追加し、PUUID、Riot ID、platform、region をユーザー別に保存する。
    - [x] `match_watchers` を追加し、ギルド単位で指定メンバーの継続監視状態と通知チャンネルを保存する。
    - [x] `/watch-match @member` と `/unwatch-match @member` を実装する。
    - [x] `/watch-match @member` で対象メンバーが Riot ID 未登録の場合に専用メッセージを返す。
    - [x] Riot Spectator-v5 で試合開始・試合中概要・終了を検知し、Discord に通知する。
    - [x] Riot Match-v5 で終了後の勝敗、KDA、CS、Gold を取得し、通知する。
    - [x] Spectator-v5 / Match-v5 の 404、429、5xx を考慮したリトライと backoff を実装する。
    - [x] Match-v5 に戦績が生成されない場合に備え、結果取得待ちのタイムアウトと IDLE 復帰を実装する。
    - [x] 結果取得タイムアウト通知で対象者、IDLE 復帰、継続監視、タイムアウト理由を確認できるようにする。
    - [x] Discord 通知失敗時も監視状態更新を継続し、完全に IDLE な対象の不要な DB 更新を抑止する。
    - [x] Riot API 制限を考慮し、ギルドごとの有効監視対象数上限を実装する。
    - [x] Riot API 呼び出しを共有キュー化し、429 と rate limit headers を後続呼び出しに反映する。
    - [x] 試合監視通知を1試合1投稿の Embed 更新にし、試合中に gameId が変わるケースへ対応する。
    - [x] 試合監視通知の表示文言を messages 管理へ移し、Riot 公式 static data の名称をDBキャッシュする。
    - [x] #34: デフォルト監視と opt-out の最小仕様、現行仕様との差分、推奨データモデル、次アクションを `docs/default-watch-opt-out.md` に整理する。
    - [x] `deno task test:riot-live` を追加し、実 Riot API で Account-v1 / Spectator-v5 / Match-v5 の疎通確認を行う。
    - [x] Discord ギルド上で `/set-riot-id`、`/watch-match`、`/unwatch-match` の応答と監視状態更新を確認する。
    - [ ] Match-v5 で取得した戦績を既存 `matches` / `match_participants` に保存し、内部レート更新へ接続する。
    - [ ] #34: デフォルト監視の通知先チャンネル設定、opt-out 永続化、Bot/API コマンド、実効監視対象解決を実装する。
    - [x] `/watch-list` でギルド内の有効な試合監視対象一覧を確認できるようにする。
    - [x] 試合結果 Embed に Match-v5 から計算できる `CS/min` と `キル関与率` を追加する。
    - [x] `deno task test:riot-live` を追加し、実 Riot API で Account-v1 / Spectator-v5 / Match-v5 の疎通確認を行う。
    - [x] Discord ギルド上で `/set-riot-id`、`/watch-match`、`/unwatch-match` の応答と監視状態更新を確認する。
    - [ ] Match-v5 で取得した戦績を既存 `matches` / `match_participants` に保存し、内部レート更新へ接続する。
    - [ ] LP delta 表示は League-v4 または試合前後スナップショット比較の設計が必要なため、現行の Match-v5 / Spectator-v5 だけでは実装しない。
    - [ ] OP.GG 等のプレイヤー外部戦績ページリンクは特定サービス URL の安定性に依存するため、実装時はリンク生成 helper と単体テストを用意してから導入する。
    - [ ] 試合中の各プレイヤーロール表示は Spectator-v5 active game の参加者情報だけでは確定できず、現行 parse 対象にも `teamPosition` 相当がないため、別データ源または推定方針を設計してから導入する。
37. [ ] 内部レートを全ギルド共有のプレイヤー評価として保存するスキーマと更新ロジックを設計する。
38. [ ] チーム分け時の戦力均等化ロジックと内部レート計算式を仕様に合わせて高度化する。
39. [ ] Discord/Riot API 呼び出しに対するリクエストキューや指数バックオフ等のレート制限対策を導入する。
40. [ ] `/my-stats`・`/next-game`・`/rematch` など SPEC 記載の追加コマンドを実装する。

## 7. Web UI

41. [ ] Web サイトの要件定義を実施し、主要ユースケース・API 連携要件を整理する。
42. [ ] 上記要件に基づき Web UI（管理者・参加者向け）を実装する。

## 8. メッセージカタログ

43. [x] ティーモ版メッセージの不足キーを補い、`check:messages` で現行ディレクトリのキー整合性を検知する。
