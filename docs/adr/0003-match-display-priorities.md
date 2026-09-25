# ADR 0003: 試合通知は必要な指標と取得可能な補足を優先する

- Type: adr
- Status: accepted
- Summary: 既存の通知実装を支える表示量・複数監視・fallbackの判断を記録する。
- Read when: renderer、通知グループ、静的データ解決の変更時。
- Related: [#55](https://github.com/akgm3i/ADTeemo/issues/55), [#65](https://github.com/akgm3i/ADTeemo/issues/65), [#66](https://github.com/akgm3i/ADTeemo/issues/66)
- Code: [renderer](../../bot/src/features/match_tracking_renderer.ts), [state](../../bot/src/features/match_tracking_state.ts)
- Tests: [renderer tests](../../bot/src/features/match_tracking_renderer.test.ts), [state tests](../../bot/src/features/match_tracking_state.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

## Context

スマートフォン上で読める通知量を維持しながら、ロールによって重要度が異なる指標を出したい。任意の補助サービスや静的データの失敗が基本通知を止めてはならない。このADRは旧表示設計の採用済み部分を記録し、未実装の追加指標は[Proposal](../proposals/match-display-extensions.md)へ分離する。

## Decision

- 通常は12 field以内を目標にし、取得可能な全情報を詰め込まない。複数行fieldは3行程度を目安とする。#100のJungle CS内訳は取得値の関係を同じfieldで保つため最大5行とする。
- ダメージは全ロール共通の基本情報とし、ロール別metric groupは最大2 fieldを基本とする。SupportではCSより視界、JungleではJG CSを優先する。
- #100では全ロールに試合時間と実際のロールを加え、マップ・モード・キュー、総量・毎分値をそれぞれまとめる。Jungleの自陣・敵陣内訳は取得値だけを表示し、`neutralMinionsKilled` の差分から中立専用値は作らない。
- ランクとOP.GG補足は基本情報の後に置く。OP.GGは試合詳細リンクと由来が分かる形で1 fieldにまとめる。
- 試合中のグループはguild、channel、Riot platform、gameで区別する。platformが異なる同じnumeric game IDを混ぜない。
- 同一試合中の複数対象は1投稿に統合する。結果通知は各対象者の情報を保ち、共有された試合中投稿を複数結果で上書きしない。
- Data Dragonの既存version/cacheからチャンピオン画像を解決する。単独対象と結果通知でthumbnailを使い、複数対象では省略する。名前は画像の有無にかかわらず残す。
- 欠損や信頼できない補助値は省略する。計算不能時の既存CS/min・キル関与率fallbackは維持する。

## Consequences

取得できる補助情報によって通知量は変わる。画像や外部サービスに失敗しても基本通知を継続できる。正確なfield順序・省略条件をMarkdownと二重管理せず、renderer/stateのテストで変更を検証する。

## Rejected alternatives

- 全員に全CS/視界指標を出す: ロールごとの重要度と表示量に合わない。
- 複数監視時に1人のthumbnailを使う: 特定の対象だけを強調してしまう。
- OP.GGプロフィールへのfallback: 試合詳細への導線という目的を満たさない。
- 欠損をすべて記号で埋める: 読む負担を増やすため、既存の計算fallback以外は省略を優先する。

## Enforcement

上記Code/Testsと[利用ガイド](../user/match-display.md)を参照する。[Discord Embedの制約](https://docs.discord.com/developers/resources/message#embed-limits)や[Riot Match-v5](https://developer.riotgames.com/apis#match-v5/GET_getMatch)の外部上限・fieldを変更理由にする場合は、変更時点で公式資料を再確認する。
