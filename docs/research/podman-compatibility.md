# Podman互換性の調査記録

- Type: research
- Status: historical
- Summary: 採用を保留したPodman検証の観測記録。現行の開発・配備はDockerを使用する。
- Read when: Podman検証を再開する判断に、過去の確認範囲と環境制約が必要なとき。
- Related: [#49](https://github.com/akgm3i/ADTeemo/issues/49), [#120](https://github.com/akgm3i/ADTeemo/issues/120)
- Code: [現行Docker Compose](../../docker-compose.yml), [Dockerfiles](../../docker), [CI](../../.github/workflows/quality.yml)
- Tests: [現行runtime設定検査](../../scripts/check-runtime-version.test.ts), [現行CI設定検査](../../scripts/quality-configuration.test.ts)
- Observed: 2026-09-25
- Reviewed: 2026-09-25
- Verified: Docker Compose 5.1.4による静的検証とrootless初期化の失敗まで。Podmanでのcontainer実起動は未検証。

## 位置づけ

ユーザーの決定により#49は保留とし、現状はDocker / Docker Composeを使用する。調査用に試作したPodman override、CIでのoverride検査、image名の完全修飾とその検査拡張は取り下げた。この文書はPodmanの採用・配備手順ではなく、当時の知見を保存する参考資料である。現在の操作は[CONTRIBUTING](../../CONTRIBUTING.md#docker)に従う。

## 調査方法と観測結果

Ubuntu 22.04環境の既存コマンドとrootless実行条件を確認した。Podmanは未導入で、Docker clientとDocker Compose 5.1.4は利用できた。`unshare -Ur true`は成功し、subuid/subgid割当も存在した。

hostへpackageをインストールせず、公開Ubuntu packageのPodman 3.4.4/conmon/crunを`/tmp/adteemo-podman`へ展開した。storageとrunrootを同directory配下に限定し、`--storage-driver vfs`と展開先の`--conmon`/`--runtime`を指定して`podman info`を試したところ、次のエラーでrootless初期化が停止した。

```text
Error: command required for rootless mode with multiple IDs: exec: "newuidmap": executable file not found in $PATH
```

`newgidmap`も未導入だった。これらのhelperが必要とするroot所有setuid権限は単なるuser権限でのpackage展開では用意できず、hostへの導入を行わない条件のため実起動へ進めなかった。probeがuserのCNI設定を自動生成したため、生成時刻を照合して当該ファイルだけを除去した。恒久的なhost設定変更、container起動、共有・本番DBへのmigrationは行っていない。

engine非接続の静的確認では、Composeと`.env.example`だけを一時directoryへコピーし、`.env`/`.env.dev`には空のplaceholderを置いた。Dockerの既定構成と、当時試作していたPodman用logging overrideを`config --no-env-resolution`で展開した。実credentialは使用していない。

| 対象                                                              | 観測結果                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Docker既定構成・試作overrideの全profile parse                     | Docker Compose 5.1.4で成功。Podman互換実行の証明ではない     |
| loopback公開・API URL・DB/cache mount・health依存・loggingのmerge | 展開JSONへのassertionで確認                                  |
| 当時のruntime/CI設定テスト                                        | 11 scenarios成功。Podman専用の追加分は採用保留に伴い取り下げ |
| rootless Podman info                                              | newuidmap未導入で停止                                        |
| dev起動・container内test:all                                      | 未実施                                                       |
| dev:all・prod API/Bot接続・health・再起動                         | 未実施                                                       |
| 実volume/SQLite保持・SELinux有効host                              | 未検証                                                       |

## 外部仕様から分かった検討点

以下は2026-09-25に確認した仕様と、試作時の検討内容である。現行repoの対応済み仕様ではない。

- `podman compose`は外部providerを呼ぶwrapperで、providerの選択により挙動が異なる。当時はDocker Compose clientをPodman互換socketへ接続する案を検討し、別実装の`podman-compose` providerは検証しなかった。[Podman公式](https://docs.podman.io/en/latest/markdown/podman-compose.1.html)
- Dockerの既定`local` logging driverと`max-file`を、そのままPodmanへ持ち込む前提にはできない。当時の試作では`k8s-file`と`max-size: 10mb`へ置換したが、Docker側の5世代保持と同等とは評価していない。[Podman logging options](https://docs.podman.io/en/latest/markdown/podman-run.1.html#log-opt-name-value)
- Composeのmappingは通常mergeされるため、driver名だけ変えるとDocker用optionが残り得る。当時はDocker Compose 2.24.4以上の`!override`でlogging全体を置換し、静的展開だけを確認した。[Composeの置換仕様](https://docs.docker.com/reference/compose-file/merge/#replace-value)
- rootless UID mapping、imageの実行ユーザー、bind mount、named volumeの所有権を実機で確認する必要がある。`keep-id`やSELinuxの`:z`/`:Z`はhostへの影響を伴うため、自動的な互換化として導入していない。[Podman user namespace](https://docs.podman.io/en/latest/markdown/podman-run.1.html#userns-mode)、[volume options](https://docs.podman.io/en/latest/markdown/podman-run.1.html#volume-v-source-volume-host-dir-container-dir-options)

現在のComposeを静的に確認した範囲では、APIはhostの`127.0.0.1:8000`、Botからは`http://api:8000`を使用する。APIのhealthcheckと`depends_on: service_healthy`があり、Bot自体にはCompose healthcheckがない。これらをPodmanで実際に稼働確認したわけではない。

## 未検証点と再確認条件

#49のcontainer実起動・テスト・DB保持・Bot接続の受入条件は残っている。再開が決まった場合は、使用するPodman/provider/imageのversion、rootless実行基盤、専用DB・volume、外部接続の許可範囲を確認する。静的parseの成功を実配備可能性へ読み替えない。

Podman、Compose provider、Deno image、logging、volume設定が変われば外部仕様と実機挙動を再確認する。再probeではuser設定の暗黙生成も含めて一時directoryへ隔離する。採用判断が変わるまでは、この記録を根拠に現行Docker運用を変更しない。
