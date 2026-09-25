# ドキュメント索引

利用方法は[README](../README.md)、開発・運用は[CONTRIBUTING](../CONTRIBUTING.md)、テスト設計は[TESTING_STYLE](../TESTING_STYLE.md)、AI agentの制約は[AGENTS](../AGENTS.md)から入る。作業・優先度・受け入れ条件・完了状態は[GitHub Issues](https://github.com/akgm3i/ADTeemo/issues)だけで管理する。

## 正本の選び方

| 確認したいこと                | 正本                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 利用できるcommand・option     | [registry](../bot/src/common/command_registry.ts)と[各command定義](../bot/src/commands)、利用者向け説明はUser guide  |
| API・DB・計算・表示順・境界値 | code / schema / tests。文書へ同じ表・式・列定義を複製しない                                                          |
| 採用理由と守る境界            | accepted ADR。実装と矛盾したら差異を調査し、黙って一方を書き換えない                                                 |
| 未採用の選択肢                | Proposal。採用済み仕様として実装へ流用しない                                                                         |
| 外部サービスの観測結果        | ResearchのObserved / Verified / 未検証点 / 再確認条件                                                                |
| task・依存・runtime・環境変数 | [deno.json](../deno.json)、workspace定義、[.dvmrc](../.dvmrc)、[.env.example](../.env.example)と設定読込・検証コード |

## 文書種別とstatus

| Type / 配置                                       | 責務                                                  | Status                               |
| ------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `adr` / `adr/`                                    | 採用済み判断、理由、結果、却下案、code/testによる保証 | `accepted`, `superseded`             |
| `proposal` / `proposals/`                         | 未採用の選択肢、trade-off、open question、決定先Issue | `proposed`, `rejected`, `superseded` |
| `research` / `research/`                          | 日付付きのnon-normativeな観測・出典・調査方法・不明点 | `current`, `historical`              |
| `integration` / `integrations/`または既存安定path | 現在の境界・運用・復旧、外部依存の再確認条件          | `current`, `superseded`              |
| `user` / `user/`                                  | 現在利用可能な操作・観測する挙動・制約                | `current`, `superseded`              |
| `content` / 対象workspace                         | message key・fallback・文体の編集規則                 | `current`, `superseded`              |
| `navigation` / 旧path                             | 外部リンクを保つ移管案内だけ                          | `moved`                              |

statusは文書の位置づけを表し、Issueの完了状態ではない。外部Researchの`current`も永続的な保証ではなく、観測日と再確認条件を必ず読む。

## Topic / 変更対象から読む

| Topic / path                                    | 最初に読む文書                                                      | 次に確認するもの                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 全体構成、workspace境界、`api/src/db/schema.ts` | [構成とデータ所有境界](./integrations/architecture.md)              | 関連repository / migration tests                                                                         |
| 認証、`api/src/service_auth.ts`、Docker公開設定 | [ADR 0001](./adr/0001-bot-service-authentication.md)                | CONTRIBUTING、auth tests                                                                                 |
| ログ、`lib/logger/`、API request middleware     | [ADR 0002](./adr/0002-structured-logging-trust-boundary.md)         | logger tests                                                                                             |
| API route、`api/src/contract/`、Bot API client  | [APIエラー契約](./api-error-contract.md)                            | schema / route / client tests                                                                            |
| パッチノート通知の担当範囲                      | [採用しない範囲](./proposals/project-scope.md#採用しない範囲)       | GAS側で対応。ADTeemoへの実装は却下                                                                       |
| RSO、auth callback、OAuth identity              | [RSOと登録アカウント](./integrations/rso.md)                        | provider / callback縦断tests、command registry                                                           |
| イベント作成・取消、`events.ts`、event saga     | [イベント整合性・復旧](./custom-game-event-consistency.md)          | [現在の操作](./user/custom-games.md)、[フロー案](./proposals/custom-game-flow.md)                        |
| 戦績、`matches.ts`、record-match                | [戦績整合性・移行](./record-match-consistency.md)                   | repository / 縦断tests                                                                                   |
| 通知outbox、再試行、Discord送信・状態保存       | [通知deliveryと復旧](./integrations/match-notification-delivery.md) | notification delivery tests                                                                              |
| 監視renderer / notifier / state                 | [試合通知ガイド](./user/match-display.md)                           | [表示ADR](./adr/0003-match-display-priorities.md)、[追加案](./proposals/match-display-extensions.md)     |
| League-v4、rank snapshot、LP計算                | [ランクADR](./adr/0004-ranked-snapshot-lifecycle.md)                | [ランク表示ガイド](./user/ranked-lp.md)                                                                  |
| OP.GG client / service                          | [OP.GG連携](./integrations/opgg.md)                                 | [判断](./adr/0005-optional-opgg-integration.md)、[観測記録](./research/opgg-server-actions.md)           |
| 登録・複数account・watcher policy               | [opt-out Proposal](./proposals/default-watch-opt-out.md)            | [Discord調査](./research/discord-lol-connections.md)、[#89](https://github.com/akgm3i/ADTeemo/issues/89) |
| `messages/**/*.json` / message key              | [messages編集ガイド](../messages/README.md)                         | [Teemo文体](../messages/TEEMO_STYLE.md)、[参考記録](./research/teemo-character-notes.md)                 |
| 新機能のscope判断                               | [未採用の拡張](./proposals/project-scope.md)                        | GitHub Issues                                                                                            |

## 種別別索引

- ADR: [0001 認証](./adr/0001-bot-service-authentication.md)、[0002 ログ](./adr/0002-structured-logging-trust-boundary.md)、[0003 表示](./adr/0003-match-display-priorities.md)、[0004 ランク](./adr/0004-ranked-snapshot-lifecycle.md)、[0005 OP.GG](./adr/0005-optional-opgg-integration.md)、[0006 accountと監視](./adr/0006-account-monitoring-policy.md)。
- Proposal: [既定監視](./proposals/default-watch-opt-out.md)、[表示拡張](./proposals/match-display-extensions.md)、[イベントフロー](./proposals/custom-game-flow.md)、[未採用の拡張](./proposals/project-scope.md)。
- Research: [Podman互換性（保留）](./research/podman-compatibility.md)、[OP.GG Server Action](./research/opgg-server-actions.md)、[Discord connected accounts](./research/discord-lol-connections.md)、[Teemo参考記録](./research/teemo-character-notes.md)。
- Integration: [account監視の運用](./integrations/account-monitoring.md)、[監視テストの責務](./match-tracking-test-ownership.md)、[RSO](./integrations/rso.md)、[通知delivery](./integrations/match-notification-delivery.md)、[構成](./integrations/architecture.md)、[OP.GG](./integrations/opgg.md)、[APIエラー](./api-error-contract.md)、[イベント整合性](./custom-game-event-consistency.md)、[戦績整合性](./record-match-consistency.md)。
- User: [account管理と監視](./user/riot-accounts-and-monitoring.md)、[カスタムゲーム](./user/custom-games.md)、[試合通知](./user/match-display.md)、[ランク・LP](./user/ranked-lp.md)。
- Content: [messages](../messages/README.md)、[Teemo](../messages/TEEMO_STYLE.md)。
- 旧pathの移管案内: [試合表示](./match-display.md)、[ランク](./ranked-lp.md)、[OP.GG](./opgg.md)、[opt-out](./default-watch-opt-out.md)、[Discord調査](./discord-lol-connections.md)、[メッセージ](./messages.md)、[Teemo](./teemo.md)。rootの旧入口は[SPEC](../SPEC.md)、[TASKS](../TASKS.md)。

## 共通headerと命名

文書名はIssue番号でなく安定した英小文字のtopic名をkebab-caseで付ける。ADRだけは通し番号を先頭に付ける。root入口、中央索引、旧pathの移管案内を除き、本文の前に次のheaderを置く。

```text
# Topic

- Type: proposal
- Status: proposed
- Summary: 何が分かる文書かを1文で記す。
- Read when: topicまたは変更対象pathから読む条件。
- Related: 関連Issueへのリンク。なければ none と理由。
- Code: 相対リンク。未実装なら none と理由。
- Tests: 相対リンク。未検証なら none と理由。
- Reviewed: YYYY-MM-DD（本文を見直した日）
- Verified: YYYY-MM-DDと検証範囲、または unknown / not adopted と理由
```

Researchには`Observed`、外部出典、調査方法、確認済み事実、未検証点、再確認条件を加える。元資料に日付がなければunknownとし、再編日を実観測日に置き換えない。Integrationも外部情報を扱う場合は検証範囲と再確認条件を持つ。

## 記述例と情報の昇格

- ADRはContext → Decision → Consequences → Rejected alternatives → Enforcement。例は[ADR 0005](./adr/0005-optional-opgg-integration.md)。重要な判断を変える場合は後続ADRを作り、旧ADRをsupersededにして相互リンクする。過去の判断を無言で上書きしない。
- Proposalは背景・選択肢・trade-off・open question・決定先Issue。例は[opt-out案](./proposals/default-watch-opt-out.md)。採用時はADRまたは現行guideへ判断を昇格し、元Proposalに移管先を残す。
- Researchは観測日・方法・出典・事実/推測の区別・未検証点・再確認条件。例は[OP.GG調査](./research/opgg-server-actions.md)。観測から設計を採用するときもResearch自体を仕様へ変えない。

Issueは問題・scope・受け入れ条件・依存・関連docの入口とする。長文調査や採用理由がIssue comment/PR discussionだけに生まれた場合はrepo文書へ昇格し、元discussionからリンクする。PRは最終変更と検証、commitは変更の履歴、code commentは局所的な「なぜ」とADRへのリンク、testsは実行可能な挙動と不変条件を担う。進捗checklistはIssueだけに置く。

Issueタイトルは自然文、種類・領域はLabels、親子はnative sub-issueと本文番号fallback、実行順はDepends on、背景共有はRelatedで表す。詳しい操作規則は[CONTRIBUTING](../CONTRIBUTING.md)が正本。Conventional CommitsをIssueタイトルへ適用しない。

## 文書の検証

repo rootで次を実行する。

```bash
deno run --allow-read scripts/check-docs.ts
deno fmt --check README.md SPEC.md TASKS.md CONTRIBUTING.md AGENTS.md docs/ messages/README.md messages/TEEMO_STYLE.md
git diff --check
```

`check-docs.ts`はroot/docs/messagesのMarkdownにある相対リンクの参照先・見出し、docs/messages文書の中央索引掲載、必須header、未知Type/Statusを検査する。Markdownのinline相対リンクを検査対象とし、外部URLの到達性は確認しない。Reviewed/Verifiedの真偽や内容の整合は関連code/testsとのreviewで確認する。自動CIへの組込みは[#122](https://github.com/akgm3i/ADTeemo/issues/122)の責務とし、この再編ではquality taskを変更しない。
