# ADR 0001: Bot service routeをBearer credentialで認証する

- Status: Accepted
- Date: 2026-07-12
- Related: GitHub Issue #111

## Context

Backend APIには、health check、Riot Sign Onのbrowser callback、Discord Botだけが呼ぶ業務endpointが同居している。従来はこれらを同じ境界で公開し、Bot専用endpointもリクエスト元を認証していなかった。

## Decision

routeを次の3分類に分け、Honoのサブアプリとして構成する。

| 分類             | route                      | 認証                                             |
| ---------------- | -------------------------- | ------------------------------------------------ |
| public           | `GET /health`              | 不要                                             |
| browser callback | `GET /auth/rso/callback`   | service credentialは不要。RSOの`state`で検証する |
| Bot service      | 上記以外の登録済みendpoint | `Authorization: Bearer <credential>`が必須       |

Bot service認証は`botServiceRoutes`サブアプリ全体へ適用し、個別endpointやpath prefixには設定しない。public routeとbrowser callbackを先にmountするため、これらはservice credentialなしで利用できる。それ以外のリクエストはdefault-denyのBot service境界を通り、未登録pathもcredentialなしでは`401 Unauthorized`、正しいcredentialがあれば`404 Not Found`となる。内部サービスAPIでは未認証時の404より、新しいrouteを設定追加なしで保護できる構造を優先する。

Bot service credentialにはDiscord token、Riot API key、RSO secretを流用せず、32〜256文字のランダム値を`BOT_SERVICE_TOKEN`へ設定する。APIはrotation中だけ`BOT_SERVICE_TOKEN_PREVIOUS`も受理し、Botは常に`BOT_SERVICE_TOKEN`だけを送信する。

APIはcredentialをSHA-256 digestへ変換して固定長で比較し、現行値と旧値の両方を毎回評価する。credentialなし、不正なscheme、不一致はいずれも`401`と共通JSONエラーを返す。

Bearer schemeとcredentialの区切りは、[RFC 9110 Section 11.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.4)および[RFC 6750 Section 2.1](https://www.rfc-editor.org/rfc/rfc6750.html#section-2.1)の`1*SP`に従い、1個以上のASCII spaceだけを受理する。tabやその他の空白文字は不正なheaderとして扱う。

```json
{ "code": "UNAUTHORIZED", "message": "Unauthorized" }
```

共通形式の正本は [APIエラー契約](../api-error-contract.md) とする。

認証失敗ログにはmethod、path、失敗理由だけを記録し、Authorization header、credential、digestを記録しない。Botもcredentialの値をログへ渡さない。

本番DockerのAPI portはhostのloopbackだけへbindする。外部からRSO callbackを受ける場合は、同一hostのTLS reverse proxyから`/auth/rso/callback`だけを転送する。BotはDocker network内の`http://api:8000`を利用する。

## Rotation

1. 新しいランダム値を生成する。
2. APIで新しい値を`BOT_SERVICE_TOKEN`、現在値を`BOT_SERVICE_TOKEN_PREVIOUS`として再起動する。
3. Botを新しい`BOT_SERVICE_TOKEN`で再起動する。
4. 旧Botが停止したことを確認し、`BOT_SERVICE_TOKEN_PREVIOUS`を削除してAPIを再起動する。

credential漏えい時は通常rotationより先に到達経路を制限し、漏えいした値を受理する時間を最小化する。

## Consequences

- Bot service routeの追加先が一つになり、認証middlewareを個別endpointへ付け忘れない。
- health checkとRSO callbackはservice credentialなしで利用できる。
- APIとBotへ同じcredentialを安全に配布し、rotation時はAPIから先に切り替える運用が必要になる。
- 単一共有credentialのためBotインスタンス単位の失効や権限分離はできない。必要になった時点でcredential ID付き署名方式またはmTLSへの移行を別ADRで判断する。

## Rejected alternatives

- Discord Bot token、Riot API key、RSO secretの流用: 権限境界とrotation周期が異なり、漏えい時の影響範囲が広がるため採用しない。
- IP allowlistだけによる認証: container networkやreverse proxyの設定ミスに対する防御にならないため、補助境界としてのみ扱う。
- JWT: 現時点では単一Botと単一API間の認証であり、issuer、audience、鍵配布を追加する利点が共有credentialの運用コストを上回らないため採用しない。
