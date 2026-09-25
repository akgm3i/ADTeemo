# Match trackingのテスト責務と移管記録

- Type: integration
- Status: current
- Summary: 旧characterization 54シナリオの所有者と現行回帰保証。
- Read when: match trackingのテスト追加・削除・責務移管・#98監査時。
- Related: [#123](https://github.com/akgm3i/ADTeemo/issues/123), [#110](https://github.com/akgm3i/ADTeemo/issues/110), [#98](https://github.com/akgm3i/ADTeemo/issues/98)
- Code: [service](../bot/src/features/match_tracking_service.ts), [renderer](../bot/src/features/match_tracking_renderer.ts)
- Tests: [service regression](../bot/src/features/match_tracking_service_regression.test.ts), [renderer result](../bot/src/features/match_tracking_renderer_result.test.ts), [composition](../bot/src/features/match_tracking.test.ts)
- Reviewed: 2026-09-25
- Verified: local regression tests including real API/DB delivery, cross-tick restart and shared Riot acquisition, 2026-09-25

## 所有者

- **S**: [Bot serviceの共有投稿・連戦回帰](../bot/src/features/match_tracking_service_regression.test.ts)。API inspectionは宣言済み契約fixture、notifierは直接依存のstrict fake。
- **E**: [既存Bot service境界](../bot/src/features/match_tracking_service.test.ts)。Backend出力・state transition・guild境界・失敗隔離。
- **R**: [result renderer](../bot/src/features/match_tracking_renderer_result.test.ts)、[renderer基本契約](../bot/src/features/match_tracking_renderer.test.ts)。表示を直接呼び出す。
- **P**: [pure state](../bot/src/features/match_tracking_state.test.ts)。時刻境界、LP、metric、ID選択。
- **B**: [Backend inspection service](../api/src/services/match_tracking.test.ts)。Riot、rank snapshot、OP.GGの業務判断。
- **I**: [実API・DB・Bot service・永続配送の接続](../bot/src/features/match_tracking_flow.integration.test.ts)。外部Riot/Discordだけをfakeにして別tick・再起動・取得回数を検証する。Discord依存を持つためBot workspaceに配置する。
- **N**: [notifier](../bot/src/features/match_tracking_notifier.test.ts)、[recovery](../bot/src/features/match_tracking_recovery.test.ts)、[durable delivery](../bot/src/features/match_tracking_delivery.integration.test.ts)。外部送信と保存の失敗収束。
- **W**: [worker](../bot/src/features/match_tracking_worker.test.ts)、[budget](../bot/src/features/match_tracking_budget.test.ts)。fake scheduler/clockで制御。

## 旧54シナリオとの対応

番号は旧 `match_tracking.test.ts` の掲載順。表の全シナリオを先に下位の所有者へ対応付け、移管先の実行後、旧ファイルを3本のcomposition smokeへ置換した。表示assertionからDiscordやRiot取得を除き、サービスassertionからBackend内のrank/OP.GG判断を除いた。

| #  | 旧保証                                                                                                               | 現在の所有者・判断                                                   |
| -- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1  | idleの監視対象が試合中になったとき、開始通知を送りIN_GAMEへ更新する                                                  | S: 同等の直接依存回帰へ移管                                          |
| 2  | ランク対象queueの試合開始を検知したとき、試合前ランクスナップショットを一時保存する                                  | B: 既存の実Backend serviceテストへ集約                               |
| 3  | 同じギルドとチャンネルで複数の監視対象が同じ試合を開始したとき、開始通知を1回だけ送り同じ投稿IDへ更新する            | S: 同等の直接依存回帰へ移管                                          |
| 4  | 共有試合中通知に複数監視対象を表示するとき、対象ごとのチャンピオンを表示し単一Riot IDをfooterに出さない              | R: rendererを直接呼び表示を検証                                      |
| 5  | 後続tickで同じ投稿IDの試合に監視対象が増えたとき、既存投稿を編集して対象者一覧を更新する                             | S: 同等の直接依存回帰へ移管                                          |
| 6  | 共有投稿IDを保持した後続監視対象だけが残ったとき、既存投稿を編集して進行中通知を継続する                             | S: 同等の直接依存回帰へ移管                                          |
| 7  | 同じ試合の既存監視対象が投稿ID未保存のとき、後続監視対象が確立した共有投稿IDを保存する                               | S: 同等の直接依存回帰へ移管                                          |
| 8  | 共有試合中投稿の編集結果が同じ投稿IDのとき、投稿ID未保存の既存監視対象にも共有投稿IDを保存する                       | S: 同等の直接依存回帰へ移管                                          |
| 9  | 共有試合中投稿が削除され新規投稿へ置換されたとき、同じ試合の未通知監視対象にも置換後投稿IDを保存する                 | S: 同等の直接依存回帰へ移管                                          |
| 10 | 同一tickで共有試合中投稿が置換された後に試合終了を検知したとき、置換後投稿IDを結果通知に使う                         | S: 同等の直接依存回帰へ移管                                          |
| 11 | 同じtickで複数のIDLE監視対象が同じ試合を開始し共有投稿が置換されたとき、先行監視対象にも置換後投稿IDを保存する       | S: 同等の直接依存回帰へ移管                                          |
| 12 | 同じgameIdでもギルドまたはチャンネルが違うとき、開始通知を統合しない                                                 | S: 同等の直接依存回帰へ移管                                          |
| 13 | 同じguild/channel/gameIdでもRiot platformが違うとき、開始通知を統合しない                                            | S: 同等の直接依存回帰へ移管                                          |
| 14 | 試合中通知間隔を過ぎたとき、既存投稿を編集する                                                                       | S: 同等の直接依存回帰へ移管                                          |
| 15 | 共有試合中投稿を進捗更新したとき、同じ共有投稿の後続監視対象は通知間隔内に再編集しない                               | S: 同等の直接依存回帰へ移管                                          |
| 16 | IDLE監視対象の開始編集後、同一tickの既存監視対象は進捗編集で開始通知を上書きしない                                   | S: 同等の直接依存回帰へ移管                                          |
| 17 | 共有試合中投稿の通知間隔内で編集を省略するとき、投稿ID未保存またはstaleな監視対象には共有投稿IDを保存する            | S: 同等の直接依存回帰へ移管                                          |
| 18 | 試合終了後にMatch-v5が取得できたとき、終了通知と戦績通知を送る                                                       | S / E: pending→resultの通知順序と保存                                |
| 19 | 同じ開始通知を共有した複数監視対象の試合終了時、後続の結果通知は共有投稿を上書きしない                               | S: 同等の直接依存回帰へ移管                                          |
| 20 | 統合前の個別試合中投稿IDが残る複数監視対象の試合終了時、それぞれの既存投稿を結果通知に使う                           | S: 同等の直接依存回帰へ移管                                          |
| 21 | primaryではない共有試合中投稿IDが残る移行状態の試合終了時、distinctな既存投稿を1回だけ結果通知に使う                 | S: 同等の直接依存回帰へ移管                                          |
| 22 | 共有投稿IDを使ったpending結果通知が残っているとき、同じ試合の後続結果通知は共有投稿を上書きしない                    | S: 同等の直接依存回帰へ移管                                          |
| 23 | legacy FETCHING_RESULTが共有投稿IDを使うとき、同じ試合の後続結果通知は共有投稿を上書きしない                         | S: 同等の直接依存回帰へ移管                                          |
| 24 | ja_JPの試合結果ではchampionIdからチャンピオン名を表示する                                                            | R: rendererを直接呼び表示を検証                                      |
| 25 | チャンピオン画像URLの解決に失敗したとき、thumbnailなしでチャンピオン名を含む試合結果を送信する                       | R: rendererを直接呼び表示を検証                                      |
| 26 | 試合結果EmbedにMatch-v5から計算できるCS/minとキル関与率を表示する                                                    | R: rendererを直接呼び表示を検証                                      |
| 27 | Topの試合結果では、共通ダメージとCSとCS/minを表示する                                                                | R: rendererを直接呼び表示を検証                                      |
| 28 | Supportの試合結果では、CSではなく視界スコアと視界スコア/minを表示する                                                | R: rendererを直接呼び表示を検証                                      |
| 29 | Jungleの試合結果では、JG CSと取得できた敵JG CSを表示する                                                             | R: rendererを直接呼び表示を検証                                      |
| 30 | 敵JG CSが欠損したJungleの試合結果では、JG CSだけを表示する                                                           | R: rendererを直接呼び表示を検証                                      |
| 31 | ロールを判定できない試合結果では、CSとCS/minへfallbackする                                                           | R: rendererを直接呼び表示を検証                                      |
| 32 | Supportのmetricが欠損した試合結果では、取得できないfieldを省略して通知する                                           | R: rendererを直接呼び表示を検証                                      |
| 33 | BackendがOP.GG詳細なしを返すとき、OP.GG項目を省略して試合結果通知を継続する                                          | R: rendererを直接呼び表示を検証                                      |
| 34 | BackendがOP.GG詳細を解決したとき、試合結果Embedに詳細リンクと補助情報を表示する                                      | R: rendererを直接呼び表示を検証                                      |
| 35 | ランク対象queueの試合結果EmbedにLP差分と現在ランクを表示する                                                         | R / P: 表示とLP・metric計算を分離                                    |
| 36 | Apex Tier間でランクが変わったとき、Tier差を400LPとして扱わずLP差分を表示する                                         | R / P: 表示とLP・metric計算を分離                                    |
| 37 | 試合結果Embedの追加戦績は試合時間やチームキルが不足してもfallback表示にする                                          | R / P: 表示とLP・metric計算を分離                                    |
| 38 | 静的データのチャンピオン名取得に失敗したとき、Match-v5の既存名で結果通知を完了する                                   | R: rendererを直接呼び表示を検証                                      |
| 39 | 静的データのモード名取得に失敗したとき、Match-v5の既存モードで結果通知を完了する                                     | R: rendererを直接呼び表示を検証                                      |
| 40 | ja_JPの試合結果では代表キューとマップとモードを日本語表示に寄せる                                                    | R: rendererを直接呼び表示を検証                                      |
| 41 | 結果取得待ちが一定時間を超えたとき、対象者とIDLE復帰理由を通知しMatch-v5を再試行しない                               | B / S / R: 期限判断と外部取得抑止、timeout通知、表示を分離           |
| 42 | 試合中のままgameIdが変わったとき、旧試合を結果取得待ちにして新試合開始を投稿する                                     | S: 同等の直接依存回帰へ移管                                          |
| 43 | 同じ旧試合通知を共有した複数監視対象が次の試合へ進んだとき、後続の旧試合結果通知は共有投稿を上書きしない             | S: 同等の直接依存回帰へ移管                                          |
| 44 | gameId変更時の新試合開始編集後、同一tickの既存監視対象は進捗編集で開始通知を上書きしない                             | S: 同等の直接依存回帰へ移管                                          |
| 45 | pending resultがある状態でも現在の試合監視を継続する                                                                 | S: 同等の直接依存回帰へ移管                                          |
| 46 | pending resultがある状態でActive Game検査が失敗しても、結果取得を先に試行する                                        | S: 同等の直接依存回帰へ移管                                          |
| 47 | IDLEかつ試合中ではない監視対象では、DB状態更新をスキップする                                                         | S: 同等の直接依存回帰へ移管                                          |
| 48 | 複数の監視対象が返されたとき、全員分の状態確認と通知と状態更新を行う                                                 | S: 同等の直接依存回帰へ移管                                          |
| 49 | 一部の監視対象でRiotアカウント取得に失敗しても、後続の監視対象を処理する                                             | E: inspection失敗と例外の隔離、guild別の結果取得                     |
| 50 | 一部の監視対象でRiot API処理に失敗しても、後続の監視対象を処理する                                                   | E: inspection失敗と例外の隔離、guild別の結果取得                     |
| 51 | 同一targetDiscordIdを複数guildで監視しているとき、1回の処理ではRiot取得を共有しつつ各guildの通知と状態更新を継続する | S / I: guild別判定を維持し、tick内のRiot元データ取得共有も縦断で保証 |
| 52 | 同一matchIdの結果取得待ちが複数guildにあるとき、guildごとのBackend Result検査で通知と状態更新を継続する              | E / I: guild別判定と投稿を維持しMatch・rank取得を共有                |
| 53 | 通知送信に失敗しても、試合開始の状態更新は継続する                                                                   | S / N: #116に従い「一時送信失敗では状態・通知時刻を進めない」へ置換  |
| 54 | workerの複数tickでRiotリクエスト予算警告をlong window内に再出力しない                                                | W: 注入clockのlong-window再警告抑止へ集約                            |

## fixture・fakeと接続テスト

[型付きfixture](../bot/src/features/testing/match_tracking_fixtures.ts) はwatcher/account/game/match/static dataを返す。[strict fake](../bot/src/features/testing/strict_fake.ts) は未予定呼び出し・引数不一致・未消費応答を検出する。検査APIの出力は直接指定し、Riot取得・rank snapshot・OP.GG判断をfake内で再実装しない。

compositionに残すのは、IDLE検査への接続、永続pendingからDiscord editとreceipt保存への接続、pending読取失敗のworkerへの伝播の3本。workerのtimer/concurrency、rendererの表示詳細、rank計算はそれぞれの所有者が保証する。実時間sleep、固定回数microtask flush、手動のglobal restoreは旧facadeとともに削除した。

## #98のclose監査

以前の「現実装で修正済み」という結論は撤回する。同一tickの直接依存テストとmutation auditだけでは、Aが結果確定してIDLEへ戻り、Bの一時失敗後に別tickで終了するケースを保証できていなかった。

Iの回帰で実DB・service・notifierを接続し、Aだけ終了→Bの検査失敗→service再生成→B終了の順で、Aの結果が消えることを再現した。修正後はoutboxが結果投稿のaccount所有権を保持し、Bには別投稿を割り当てる。tick内の使用済みID集合は補助であり、永続所有権が上書き防止を担う。

同じ縦断テストで進捗の3回失敗→backoff中にpending/result→再起動後の期限到来を検証する。後続の通知段階・世代に置き換わった配送は`superseded`で失効し、結果を古い進捗へ戻さない。DBテストは逆順prepareと有効lease中の後続claim待機も保証する。

これらの再現条件では修正後の回帰テストが成功する。Discord/Riot実接続の検証や外部Issueのclose操作は行っていない。

## 検証方法

```bash
deno task test:target bot/src/features/match_tracking.test.ts bot/src/features/match_tracking_service_regression.test.ts bot/src/features/match_tracking_renderer_result.test.ts bot/src/features/match_tracking_state.test.ts bot/src/features/match_tracking_service.test.ts bot/src/features/match_tracking_worker.test.ts bot/src/features/match_tracking_budget.test.ts api/src/services/match_tracking.test.ts
```

通知失敗・再起動はNの3ファイル、RPC/DBの接続は対応するcontract / repository / vertical integrationで確認する。全変更の型検証・qualityは統合時に行い、runtimeのみの確認をquality成功とは扱わない。
