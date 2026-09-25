# Riot Sign Onと登録アカウント

- Type: integration
- Status: current
- Summary: RSO callbackからcanonical Riot accountへの保存、認証stateの境界、提供前に確認する外部設定を説明する。
- Read when: RSO、auth routes、登録アカウント、link-riot-account commandを変更するとき。
- Related: [#117](https://github.com/akgm3i/ADTeemo/issues/117)、[#89](https://github.com/akgm3i/ADTeemo/issues/89)
- Code: [RSO provider](../../api/src/rso.ts)、[auth routes](../../api/src/routes/auth.ts)、[auth repository](../../api/src/db/repositories/auth.ts)、[canonical account repository](../../api/src/db/repositories/users.ts)、[command registry](../../bot/src/common/command_registry.ts)
- Tests: [provider](../../api/src/rso.test.ts)、[routes](../../api/src/routes/auth.test.ts)、[callbackからBot参照まで](../../tests/integration/rso_account.integration.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25。fake OAuthと実Hono・本番migration適用済みの隔離SQLiteで保存・再参照・競合・再送を検証。実RSO認可、client承認、redirect登録は未検証。

## 現在の提供状態

`/link-riot-account`はregistryで無効であり、公開commandに含めない。Backendの認証・保存経路は実装済みだが、RiotのProduction承認、発行されたclient credential、実redirect登録は確認できていない。現在利用できる登録手段は`/set-riot-id`。command提供可否の正本はregistryとする。

[Riot公式のRSO Integration](https://developer.riotgames.com/docs/lol#rso-integration)ではProduction Level keyを持つ開発者向けの申請・承認手続きが説明されている。提供を有効にする前に、対象アプリケーションの承認、設定されたcredential、ブラウザから到達できるcallback URI、実認可から登録までの動作を確認する。外部登録や本番設定の変更はこのローカル検証には含まれない。

環境変数の正本は[設定例](../../.env.example)。`RSO_REDIRECT_URI`を公開originとし、providerは末尾に`/auth/rso/callback`を付ける。authorizationとtoken交換で同じURIを使う。公開範囲・proxy設定は[CONTRIBUTING](../../CONTRIBUTING.md)を参照する。

## identityと保存先

OAuthの`sub`、ゲームアカウントのPUUID、表示用の`GameName#TagLine`は別の値として扱う。access tokenでAccount-v1の`/riot/account/v1/accounts/me`を取得し、返された`puuid`・`gameName`・`tagLine`だけをcanonical accountへ保存する。ID tokenやuserinfoの`sub`からPUUIDを作らない。[公式の取得手順](https://developer.riotgames.com/docs/lol#rso-integration)

callbackは通常の登録と同じaccount repositoryを使う。Botのaccount参照、戦績・監視の照合もそのcanonical accountを読む。同じ所有者による同じPUUIDの再連携は既存行を更新し、表示名の変更を反映する。別のDiscord所有者が保有するPUUIDは競合として拒否する。複数アカウントの追加とmain選択はrepositoryの規則に従い、再認可だけでmainを変更しない。

## stateと失敗時の扱い

サービス認証済みのlogin-url要求からDiscord user、guild、platform、regionをstateに保存する。公開callbackはcodeとstateだけを受け付け、所有者やguildをqueryで上書きできない。platformとregionも保存した値を使用する。

stateは発行後5分未満だけ有効とし、SQLiteの`DELETE RETURNING`で一度だけ取得する。同時callbackでも一方だけがOAuth交換・保存へ進む。期限切れ、未知state、移行前のguild未設定stateは拒否する。provider障害やDB障害でもstateは再利用できないため、利用者は新しい認可URLを取得してやり直す。

成功画面はcanonical保存後に返す。所有権競合は409、provider障害は502、DB等の内部障害は500とし、共通[APIエラー契約](../api-error-contract.md)へ従う。providerの生レスポンス、code、access token、ID tokenは保存・ログ出力しない。providerエラーには操作種別とHTTP statusだけを保持する。

## legacy列の廃止方針

旧`users.riot_id`はschemaに残っているが、callbackは書き込まず、Botのaccount参照もこの列を読まない。値には旧実装が格納したOAuth subjectが含まれ得るため、PUUIDや表示用Riot IDとみなして自動移行しない。

移行時は利用者の再連携、または公式APIで確認できるcanonical accountを使う。残存データの調査と復旧手段を確認した後、未使用のlegacy repository操作と列を削除するmigrationを別途実施する。今回のmigrationで曖昧な既存値を削除・上書きしない。

## 再確認条件

Riotの申請条件、authorization/token endpoint、Account-v1認証方式、redirect要件が変わったときは公式資料を再確認する。型・fake testの成功だけでは実RSO credentialの有効性や公開proxyの設定を保証しない。公開を有効にするときは実環境の承認と疎通の検証結果をこの文書へ追記する。
