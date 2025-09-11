# ADTeemo

![GitHub License](https://img.shields.io/github/license/akgm3i/ADTeemo)

## 概要

## 主な機能

## コマンド一覧

## 技術仕様

[SPEC.md](SPEC.md)

## 環境構築

### Requirements

- Deno

### Environments

- `.env`: 本番環境用
- `.env.dev`: 開発環境用

`.env.example`ファイルをテンプレートとして使用できる。

### Deno Tasks

| Task | Description |
| --- | --- |
| `dev:all` | APIとBotを開発モードで起動。 |
| `dev:api` | APIを開発モードで起動。 |
| `dev:bot` | Botを開発モードで起動。 |
| `test:all` | すべてのテストを実行。 |
| `db:push` | データベースのスキーマを更新。 |
| `db:generate` | Drizzle Kitを使用してマイグレーションファイルを生成。 |
| `db:migrate` | マイグレーションを実行。 |
| `deploy-commands` | Discordにスラッシュコマンドを登録。 |
| `db:backup` | 本番データベースのバックアップを作成。 |
| `db:restore-local` | バックアップからローカルデータベースを復元。 |

## Docker

Dockerを使用した環境構築について記載する。

### Requirements

- Docker

### 本番環境 (Production)

本番環境は、最適化されたコンテナを実行するように構成されている。

#### ビルドして起動

```bash
docker compose --profile prod up -d --build
```

サービスはバックグラウンドで実行されている。ログを確認するには `docker compose --profile prod logs -f` を使用する。

#### 停止

```bash
docker compose --profile prod down
```

### 開発環境 (Development)

開発環境は、ホットリロードと対話的なアクセスを伴うローカル開発用に設計されている。

#### ビルドして起動

```bash
docker compose --profile dev up -d --build
```

これにより`dev`サービスが起動する。コンテナは実行状態になるが、Denoアプリケーションは自動的には開始されない。
Deno taskをDocker composeを通じて実行する。
```bash
docker compose exec dev deno task dev:all
```

#### 対話シェルを開く

実行中のサービスコンテナ内で対話シェルにアタッチする。

```bash
docker compose exec dev bash
```
