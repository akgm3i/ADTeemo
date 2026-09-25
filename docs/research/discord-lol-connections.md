# Discord LoL / Riot Games connected accounts調査

- Type: research
- Status: current
- Summary: 現行公式資料の再確認、過去のservice type記述の訂正、実OAuth未検証点。
- Read when: Discord連携を実装する前、OAuth2仕様変更時。
- Related: [#35](https://github.com/akgm3i/ADTeemo/issues/35), [#89](https://github.com/akgm3i/ADTeemo/issues/89)
- Code: [RSO routes](../../api/src/routes/auth.ts)
- Tests: [auth tests](../../api/src/routes/auth.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25、Discord/Riotの公開公式資料。user consent/tokenを伴う実データは未検証。

- Observed: 旧メモはunknown（観測日の記録なし）。今回の公式資料参照は2026-09-25。

non-normativeな調査記録。2026-09-25に公開公式資料を再読した。旧メモの観測日は推測で補わず、実アカウントのOAuth2同意・user token・接続応答は確認していない。

## 結論

Discordのconnected accountsをRiot ID登録補助に使えるかは、現時点で成立を確認できていない。現行の公式Services一覧には`leagueoflegends`と`riotgames`が掲載されておらず、旧メモの「定義されている」という記述は今回の資料から支持できない。これだけで過去連携の実データも存在しないとは断定しない。Bot tokenは任意のGuildMember本人のOAuth認可を代替しない。

ユーザーのDiscord連携情報を読むには、ユーザー本人の同意を得たDiscord OAuth2 user tokenが必要です。connections取得自体の必須scopeは`connections`である。ADTeemoの登録者との紐付けには`/users/@me`も使う想定なので、そのフローでは`identify`も要求する。また、Discord OAuth2フローを運用するにはredirect URIの登録と、ADTeemo側でのcallback受け口が必要です。

redirect URIや実データ検証の作業・判断は関連Issueで追跡します。この記録だけで現行APIの成立を断定しません。

## 公式情報で確認したこと

- Discord User ResourceのConnection Objectには `id`, `name`, `type`, `verified`, `visibility` などがあります。
- 現行Connection Services一覧には`leagueoflegends`と`riotgames`は掲載されていない。旧メモの記述と異なるが、削除時期・旧連携の返却可否はこの資料だけでは分からない。
- Connectionの`id`は接続先account ID、`name`はusernameという一般的な説明であり、PUUID・完全なRiot ID・routing regionの保証はない。
- `GET /users/@me/connections` はcurrent userのconnection object listを返します。
- `GET /users/@me/connections` には `connections` OAuth2 scopeが必要です。
- Discord OAuth2におけるBot Tokenはbot userとしての認証であり、サーバー内メンバー本人の代理認可ではありません。
- ユーザー本人のlinked accountsを読むには、ユーザー同意付きのOAuth2 user tokenが必要です。
- discord.js coreの `UsersAPI#getConnections()` はcurrent user's connectionsを取得するAPIであり、Bot tokenで任意のGuildMemberのconnectionsを読むAPIではありません。

参照:

- https://docs.discord.com/developers/resources/user
- https://docs.discord.com/developers/topics/oauth2
- https://discord.js.org/docs/packages/core/2.0.1/UsersAPI%3AClass

## ADTeemoで利用する場合の前提

ADTeemo BotがDiscordギルド上で `/set-riot-id` の代わりに自動登録を行うには、次のような別フローが必要です。

1. ユーザーにDiscord OAuth2認可URLを案内する。
2. ユーザーが `identify connections` scopeに同意する。
3. DiscordがADTeemoのredirect URIにauthorization codeを返す。
4. Backend APIがcodeをuser tokenに交換する。
5. Backend APIが `GET /users/@me/connections` をuser tokenで呼び出す。
6. 実応答でRiotに相当するtypeが存在するかを確認する。旧候補の`leagueoflegends`/`riotgames`を現行仕様として固定しない。
7. 抽出した値をRiot Account-v1 / RSOなどで検証し、登録候補として提示または保存する。

このフローにはredirect URIの登録、callback endpoint、state検証、CSRF対策、tokenの保存方針、tokenを保存しない場合の短時間処理方針が必要です。

## 未検証点

Riotに相当するConnectionが返るか自体が未検証である。さらに、`id` と `name` がRiot ID、PUUID、region、taglineのどれに対応するか、または登録に十分な正規化済み情報かは未検証です。

検証手順:

1. Discord Developer PortalにADTeemo検証用redirect URIを登録する。
2. 検証用アカウントでDiscordにLeague of Legends / Riot Gamesを連携する。
3. `identify connections` scope 付きでOAuth2認可する。
4. user tokenで `GET /users/@me/connections` を呼び出す。
5. 実際に返るtypeと`id`, `name`, `verified`, `visibility`の形を、識別値を匿名化して記録する。候補typeが返らない場合も観測結果として残す。
6. `name` が `gameName#tagLine` として使えるか確認する。
7. `id`を未検証のままPUUIDとして送信・保存しない。Riot Account-v1の正式応答で照合して、どの値を確認できたか記録する。
8. region / platformが含まれない場合、既定値、ユーザー選択、Riot APIからの補完のどれで扱うか決める。
9. `verified: false` やprivate visibilityの扱いを決める。

この検証が終わるまで、Discord Connection Objectの値をそのまま ADTeemoのRiot account正本として保存しない方針にします。

## 既存フローとの関係

既存の `/set-riot-id` は、ユーザーがRiot IDを手入力し、ADTeemo側でRiot APIによりPUUID等へ正規化するフローです。Discord connected accounts連携を導入する場合も、当面は `/set-riot-id` をfallbackとして維持します。

候補:

- 現状維持: `/set-riot-id` を主導線にする。実装コストとOAuth2運用コストが最小です。
- Discord OAuth2補助: ユーザー同意後にconnected accountsからRiot候補を取得し、確認画面またはDiscord interactionで登録候補として提示します。redirect URIとcallback実装が必要です。
- RSO正規化の改善: Riot RSOまたはRiot Account-v1を使い、手入力されたRiot IDの正規化、tagline 表記揺れ、region / platformの補完を改善します。
- 手入力fallback: Discord連携が無い、`name` が登録に使えない、regionが不足する、ユーザーがOAuth2に同意しない場合は `/set-riot-id` に戻します。

## RSOと現在の実装

Riot公式資料では、RSOにはProduction Level API Keyが必要で、LoLの本人identityはBearer tokenを使う`/riot/account/v1/accounts/me`で得る。`userinfo.sub`やDiscord Connection idをそのままPUUIDとして扱わない。[Riot RSO公式資料](https://developer.riotgames.com/docs/lol#rso-integration)

ADTeemoは[RSOのcanonical保存とstate検証](../integrations/rso.md)を実装したが、実承認・credential・redirect・同意による本番成立は未検証である。Discord connections取得のOAuth flowは未実装。利用者は現在の`/set-riot-id`でRiot公式照合を行う。登録・メイン・監視の確定した方針は[ADR 0006](../adr/0006-account-monitoring-policy.md)へ分ける。

## 再確認条件

実装着手前、Discordのscope/Connection Object変更、Riot identity model変更時に、上記公式資料を再確認する。user tokenによる実データ検証では同意済みの検証アカウントを使い、tokenや個人情報をログ・fixtureへ残さない。redirect URI決定、callback実装、採用判断は関連Issueが正本である。
