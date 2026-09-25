# 仕様・設計の参照先

仕様と設計の入口は[docs/README.md](./docs/README.md)です。この文書は移管先のnavigationだけを保持し、進捗、将来checklist、API/DB契約を複製しません。

| 旧SPECの内容                                  | 正本・移管先                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目的と提供機能                                | [README](./README.md)、[カスタムゲーム利用ガイド](./docs/user/custom-games.md)                                                                                                                     |
| 構成・データ所有権                            | [構成とデータ所有境界](./docs/integrations/architecture.md)、[DB schema](./api/src/db/schema.ts)                                                                                                   |
| ユーザー・ロール管理、募集・チーム分け        | [利用ガイド](./docs/user/custom-games.md)、[command定義](./bot/src/commands)                                                                                                                       |
| イベント作成・取消の不変条件                  | [イベント整合性と復旧](./docs/custom-game-event-consistency.md)                                                                                                                                    |
| 戦績のatomic保存・冪等性・移行                | [戦績整合性と移行](./docs/record-match-consistency.md)                                                                                                                                             |
| 監視・試合表示・ランク                        | [試合表示](./docs/user/match-display.md)、[ランク表示](./docs/user/ranked-lp.md)、[表示ADR](./docs/adr/0003-match-display-priorities.md)、[rank ADR](./docs/adr/0004-ranked-snapshot-lifecycle.md) |
| OP.GG連携・調査                               | [Integration](./docs/integrations/opgg.md)、[Research](./docs/research/opgg-server-actions.md)、[ADR](./docs/adr/0005-optional-opgg-integration.md)                                                |
| カスタムゲームの将来フロー                    | [未採用Proposal](./docs/proposals/custom-game-flow.md)                                                                                                                                             |
| 既定監視とDiscord連携調査                     | [Proposal](./docs/proposals/default-watch-opt-out.md)、[Research](./docs/research/discord-lol-connections.md)                                                                                      |
| 複数account、Podman、パッチノート、その他構想 | [要求の整理と参照先](./docs/proposals/project-scope.md)、[GitHub Issues](https://github.com/akgm3i/ADTeemo/issues)                                                                                 |
| 認証・外部公開・ログ                          | [認証ADR](./docs/adr/0001-bot-service-authentication.md)、[ログADR](./docs/adr/0002-structured-logging-trust-boundary.md)、[運用](./CONTRIBUTING.md)                                               |
| HTTPエラー、Riot queue、message、テスト       | [APIエラー](./docs/api-error-contract.md)、[構成ガイド](./docs/integrations/architecture.md)、[messages](./messages/README.md)、[TESTING_STYLE](./TESTING_STYLE.md)                                |

正確なAPI・DB・command・message契約はcode/schema/tests、taskと依存はdeno.jsonが正本です。
