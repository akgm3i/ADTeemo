# 未採用の拡張と旧Roadmapの整理

- Type: proposal
- Status: proposed
- Summary: 旧SPEC/TASKSの未Issue化候補を、現行要求と混同せず保存する。
- Read when: 既存Issueに収まらない機能の採用を判断するとき。
- Related: [#51](https://github.com/akgm3i/ADTeemo/issues/51), [#89](https://github.com/akgm3i/ADTeemo/issues/89), [#126](https://github.com/akgm3i/ADTeemo/issues/126)
- Code: [schema](../../api/src/db/schema.ts), [tasks](../../deno.json)
- Tests: [test strategy](../../TESTING_STYLE.md)
- Reviewed: 2026-09-25
- Verified: not adopted

この文書は作業queueでも進捗表でもない。旧Roadmapにあった構想を整理し、採用前に必要な判断を保持する。ここにあるだけでは実装を決定しない。採用する場合はscopeと受け入れ条件を定めてGitHub Issueを正本にする。

## 既存Issueへ集約する要求

| 旧項目                                                                        | 要求・判断の参照先                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 既定監視、複数アカウント、Discord登録補助                                     | [#89](https://github.com/akgm3i/ADTeemo/issues/89)、[opt-out案](./default-watch-opt-out.md)         |
| ギルド設定、role ID、Customメンション、setup再同期、event中心UI、簡易戦績入力 | [#51](https://github.com/akgm3i/ADTeemo/issues/51)、[フロー案](./custom-game-flow.md)               |
| Podman互換性（保留。現行運用はDocker）                                        | [#49](https://github.com/akgm3i/ADTeemo/issues/49)、[検証記録](../research/podman-compatibility.md) |
| production BotのDeno権限縮小                                                  | [#88](https://github.com/akgm3i/ADTeemo/issues/88)                                                  |

旧TASKSのAPIエラー統一案、eventとmatchの関連、record-match保存API、legacy Riot IDモデルは、それぞれ[APIエラー契約](../api-error-contract.md)、[戦績整合性](../record-match-consistency.md)、現在の[schema](../../api/src/db/schema.ts)を参照する。旧形式のAPIエラー提案や実装済み処理を、新たな未実装タスクとして維持しない。

## 採用しない範囲

2026-09-25の3iの決定により、[#50](https://github.com/akgm3i/ADTeemo/issues/50)のパッチノート通知は実装済みのGAS側で扱い、ADTeemoへの実装は却下する。ADTeemoには購読API、配信worker、command、ニュース専用DBを追加しない。GAS側のコードと運用はこのリポジトリの管理対象外であり、今回の検証対象にも含めない。

## 独立した採用判断が必要な構想

- Match-v5戦績を個人集計・全ギルド共通の内部レートへ接続する構想。カスタムと公式試合の識別、再計算、重複計上、account再リンク時のidentity、レート式を決める必要がある。個人戦績commandはこの集計契約の後で判断する。
- 管理者・参加者向けWeb UI。利用者、認証・権限、主要ユースケース、Discordとの操作の分担を決めるまでは、実装作業として扱わない。
- 通常テストのsys/ffi権限縮小。現行の実SQLite integration testに必要な権限を無条件に外さない。依存の変更や実際の権限縮小要求が発生した時点で、Deno/native driverの要件を再評価する。

上の構想には専用の採用Issueが確認できていない。文書再編で新しいIssueや採用決定を作らず、決定先の不足を明示して残す。
