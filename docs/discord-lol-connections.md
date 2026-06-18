# Discord LoL / Riot Games連携情報の調査メモ

## 結論

DiscordのLeague of Legends / Riot Games連携情報を使って、ADTeemoのRiot ID登録を補助できる可能性はあります。ただし、Bot tokenだけで任意のGuildMemberのconnected accountsを読むことはできません。

ユーザーのDiscord連携情報を読むには、ユーザー本人の同意を得たDiscord OAuth2 user tokenが必要です。scopeは少なくとも `identify connections` を要求します。また、Discord OAuth2フローを運用するにはredirect URIの登録と、ADTeemo側でのcallback受け口が必要です。

そのため、issue #35 はredirect URIを決定してから再開します。現時点ではコード実装を行わず、調査結果と設計上の注意点のみを残します。

## 公式情報で確認したこと

- Discord User ResourceのConnection Objectには `id`, `name`, `type`, `verified`, `visibility` などがあります。
- Connection service typeには `leagueoflegends` と `riotgames` が定義されています。
- `GET /users/@me/connections` はcurrent userのconnection object listを返します。
- `GET /users/@me/connections` には `connections` OAuth2 scopeが必要です。
- Discord OAuth2におけるBot Tokenはbot userとしての認証であり、サーバー内メンバー本人の代理認可ではありません。
- ユーザー本人のlinked accountsを読むには、ユーザー同意付きのOAuth2 user tokenが必要です。
- discord.js coreの `UsersAPI#getConnections()` はcurrent user's connectionsを取得するAPIであり、Bot tokenで任意のGuildMemberのconnectionsを読むAPIではありません。

参照:

- https://docs.discord.com/developers/resources/user
- https://docs.discord.com/developers/platform/oauth2-and-permissions
- https://discord.js.org/docs/packages/core/2.0.1/UsersAPI%3AClass

## ADTeemoで利用する場合の前提

ADTeemo BotがDiscordギルド上で `/set-riot-id` の代わりに自動登録を行うには、次のような別フローが必要です。

1. ユーザーにDiscord OAuth2認可URLを案内する。
2. ユーザーが `identify connections` scopeに同意する。
3. DiscordがADTeemoのredirect URIにauthorization codeを返す。
4. ADTeemo APIがcodeをuser tokenに交換する。
5. ADTeemo APIが `GET /users/@me/connections` をuser tokenで呼び出す。
6. `type` が `leagueoflegends` または `riotgames` のConnection Objectを抽出する。
7. 抽出した値をRiot Account-v1 / RSOなどで検証し、登録候補として提示または保存する。

このフローにはredirect URIの登録、callback endpoint、state検証、CSRF対策、tokenの保存方針、tokenを保存しない場合の短時間処理方針が必要です。

## 未検証点

Connection Objectの `type` からLoL / Riot Games連携であることは判別できる見込みです。一方で、`id` と `name` がRiot ID、PUUID、region、taglineのどれに対応するか、または登録に十分な正規化済み情報かは未検証です。

検証手順:

1. Discord Developer PortalにADTeemo検証用redirect URIを登録する。
2. 検証用アカウントでDiscordにLeague of Legends / Riot Gamesを連携する。
3. `identify connections` scope 付きでOAuth2認可する。
4. user tokenで `GET /users/@me/connections` を呼び出す。
5. `type: "leagueoflegends"` と `type: "riotgames"` の `id`, `name`, `verified`, `visibility` を記録する。
6. `name` が `gameName#tagLine` として使えるか確認する。
7. `id` がPUUIDなどRiot APIの識別子として使える値か確認する。
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

## 次アクション

- Discord OAuth2のredirect URIを決定する。
- redirect URI決定後、callback endpoint、state検証、token交換、connections取得の設計を再開する。
- 実データ検証後、Connection Objectの `name` / `id` をADTeemoの登録プロセスに使えるか判断する。
