# Discord LoL / Riot Games 連携情報の調査メモ

## 結論

Discord の League of Legends / Riot Games 連携情報を使って、ADTeemo の Riot ID 登録を補助できる可能性はあります。ただし、Bot token だけで任意の GuildMember の connected accounts を読むことはできません。

ユーザーの Discord 連携情報を読むには、ユーザー本人の同意を得た Discord OAuth2 user token が必要です。scope は少なくとも `identify connections` を要求します。また、Discord OAuth2 フローを運用するには redirect URI の登録と、ADTeemo 側での callback 受け口が必要です。

そのため、issue #35 は redirect URI を決定してから再開します。現時点ではコード実装を行わず、調査結果と設計上の注意点のみを残します。

## 公式情報で確認したこと

- Discord User Resource の Connection Object には `id`, `name`, `type`, `verified`, `visibility` などがあります。
- Connection service type には `leagueoflegends` と `riotgames` が定義されています。
- `GET /users/@me/connections` は current user の connection object list を返します。
- `GET /users/@me/connections` には `connections` OAuth2 scope が必要です。
- Discord OAuth2 における Bot Token は bot user としての認証であり、サーバー内メンバー本人の代理認可ではありません。
- ユーザー本人の linked accounts を読むには、ユーザー同意付きの OAuth2 user token が必要です。
- discord.js core の `UsersAPI#getConnections()` は current user's connections を取得する API であり、Bot token で任意の GuildMember の connections を読む API ではありません。

参照:

- https://docs.discord.com/developers/resources/user
- https://docs.discord.com/developers/platform/oauth2-and-permissions
- https://discord.js.org/docs/packages/core/2.0.1/UsersAPI%3AClass

## ADTeemo で利用する場合の前提

ADTeemo Bot が Discord ギルド上で `/set-riot-id` の代わりに自動登録を行うには、次のような別フローが必要です。

1. ユーザーに Discord OAuth2 認可 URL を案内する。
2. ユーザーが `identify connections` scope に同意する。
3. Discord が ADTeemo の redirect URI に authorization code を返す。
4. ADTeemo API が code を user token に交換する。
5. ADTeemo API が `GET /users/@me/connections` を user token で呼び出す。
6. `type` が `leagueoflegends` または `riotgames` の Connection Object を抽出する。
7. 抽出した値を Riot Account-v1 / RSO などで検証し、登録候補として提示または保存する。

このフローには redirect URI の登録、callback endpoint、state 検証、CSRF 対策、token の保存方針、token を保存しない場合の短時間処理方針が必要です。

## 未検証点

Connection Object の `type` から LoL / Riot Games 連携であることは判別できる見込みです。一方で、`id` と `name` が Riot ID、PUUID、region、tagline のどれに対応するか、または登録に十分な正規化済み情報かは未検証です。

検証手順:

1. Discord Developer Portal に ADTeemo 検証用 redirect URI を登録する。
2. 検証用アカウントで Discord に League of Legends / Riot Games を連携する。
3. `identify connections` scope 付きで OAuth2 認可する。
4. user token で `GET /users/@me/connections` を呼び出す。
5. `type: "leagueoflegends"` と `type: "riotgames"` の `id`, `name`, `verified`, `visibility` を記録する。
6. `name` が `gameName#tagLine` として使えるか確認する。
7. `id` が PUUID など Riot API の識別子として使える値か確認する。
8. region / platform が含まれない場合、既定値、ユーザー選択、Riot API からの補完のどれで扱うか決める。
9. `verified: false` や private visibility の扱いを決める。

この検証が終わるまで、Discord Connection Object の値をそのまま ADTeemo の Riot account 正本として保存しない方針にします。

## 既存フローとの関係

既存の `/set-riot-id` は、ユーザーが Riot ID を手入力し、ADTeemo 側で Riot API により PUUID 等へ正規化するフローです。Discord connected accounts 連携を導入する場合も、当面は `/set-riot-id` を fallback として維持します。

候補:

- 現状維持: `/set-riot-id` を主導線にする。実装コストと OAuth2 運用コストが最小です。
- Discord OAuth2 補助: ユーザー同意後に connected accounts から Riot 候補を取得し、確認画面または Discord interaction で登録候補として提示します。redirect URI と callback 実装が必要です。
- RSO 正規化の改善: Riot RSO または Riot Account-v1 を使い、手入力された Riot ID の正規化、tagline 表記揺れ、region / platform の補完を改善します。
- 手入力 fallback: Discord 連携が無い、`name` が登録に使えない、region が不足する、ユーザーが OAuth2 に同意しない場合は `/set-riot-id` に戻します。

## 次アクション

- issue #35 にこの調査結果をコメントする。
- Discord OAuth2 の redirect URI を決定する。
- redirect URI 決定後、callback endpoint、state 検証、token 交換、connections 取得の設計を再開する。
- 実データ検証後、Connection Object の `name` / `id` を ADTeemo の登録プロセスに使えるか判断する。
