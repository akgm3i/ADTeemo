# ADTeemo Project

## Project Overview

This project is a Discord bot named "ADTeemo" designed to facilitate the organization of custom games for the popular online game League of Legends. The system is composed of two main components: a Discord bot and a backend API server. The entire system is containerized using Docker.

- **Backend:** Deno, TypeScript
- **API:** Hono (RPC)
- **Database:** SQLite (with Drizzle ORM)
- **Discord Bot:** discord.js

The bot helps with everything from recruiting players and balancing teams to tracking game results and managing player ratings.

### Deno v2+ Technology Notes

This project uses **Deno v2.5** or a later version. All development must adhere to modern Deno v2+ standards and practices.

- **LLM Agent Advisory:** As an LLM agent, you **must not** use information or practices from Deno v1. All proposals and code must be compatible with the latest Deno v2 standards and the conventions established in this project.
- **Package Registry:** The primary package registry is **JSR (`jsr.io`)**. The legacy `deno.land/x` registry should not be used for adding new dependencies.
- **Node.js Compatibility:** Deno v2 provides strong compatibility with Node.js and npm packages, which can be leveraged when necessary via `npm:` specifiers.
- **Testing & Mocks:** Tests are written using the standard library (e.g., `jsr:@std/testing`). Mocking of dependencies must be achieved through standard software design patterns like **Dependency Injection (DI)**, typically using a **Factory Pattern**. Outdated conventions for mocking, such as using a `deps.ts` file to centralize internal dependencies for stubbing, are not the preferred approach for this project.

### Hono Technology Notes

- **LLM Agent Advisory:** For technical details on Hono, please refer to the full documentation with web_fetch tool at https://hono.dev/llms-full.txt.


## Building and Running

The project uses Deno's task runner and Docker for development.

### Deno Tasks

You can run various development tasks using `deno task <task_name>`. These can be run directly on your local machine if you have Deno installed, or within the development Docker container.

| Task | Description |
| --- | --- |
| `dev:all` | Starts both the API and the bot in development mode. |
| `dev:api` | Starts the API in development mode. |
| `dev:bot` | Starts the bot in development mode. |
| `test:all` | Runs all tests. |
| `db:push` | Pushes database schema changes. |
| `db:generate` | Generates migration files using Drizzle Kit. |
| `db:migrate` | Runs database migrations. |
| `deploy-commands` | Deploys slash commands to Discord. |
| `db:backup` | Backs up the production database. |
| `db:restore-local` | Restores the local database from a backup. |

### Docker (Development)

Docker can be used to run the application in a development environment.

```bash
docker compose --profile dev up -d --build
```

While you can open an interactive shell with `docker compose exec dev bash`, it is often more convenient to run Deno tasks directly:

```bash
docker compose exec dev deno task dev:all
```

## Commit & Interaction Rules

- **Commit Messages:** Use a customized version of [Conventional Commits](https://www.conventionalcommits.org/). All commit messages must be in Japanese. See the custom specification below.
- **Language:** The conversation with the user must be written in Japanese, and the thought process can be written in English.

### Custom Conventional Commits Specification

Commit messages should describe the context behind the changes, rather than what was changed. Since the code itself shows what was changed, the message should focus on explaining the background and reasons for the change.

#### Format

```
<type>[optional scope]: <description>

[optional body]
```

#### `type`

| type | Description |
| :--- | :--- |
| `feat` | Adding new features |
| `fix` | Bug fixes |
| `refactor` | Refactoring (improving code without functional changes) |
| `perf` | Performance improvements |
| `style` | Code style changes only (formatting, semicolons, etc.) |
| `test` | Adding and modifying tests |
| `docs` | Documentation Changes |
| `build` | Build system and external dependency changes (Deno, Docker, npm, etc.) |
| `ci` | CI/CD related changes |
| `chore` | Miscellaneous changes that don't fit into any of the above categories |

#### `scope`

- api
- bot
- messages
- db
- docker

## Development Conventions

- The project strictly follows a Test-Driven Development (TDD) workflow. All new features or bug fixes must start with writing tests.

### TDD Workflow

1.  **Describe Expected Behavior:** Before writing any code, describe the expected behavior in a test. The test name should clearly explain the **context (situation)**, the **action (operation)**, and the **expected result**. For example: `"有効なイベント名、未来の日付と時刻が指定された場合、Discordイベントを作成し、参加者募集メッセージを投稿する"` (Given a valid event name and a future date/time, when the command is executed, it creates a Discord event and posts a recruitment message).
2.  **Write Assertion and Seek Confirmation:** Implement the assertion for the expected behavior in the test. Present this test case to the user to confirm that the described behavior is correct. **Do not proceed without user agreement.**
3.  **Implement Failing Test (Red):** Once the user agrees, complete the test implementation. Since the feature's code doesn't exist yet, this test is expected to fail. Run the test to confirm it fails as expected.
4.  **Implement Feature (Green):** Write the actual application code to make the test pass.
5.  **Verify:** Run all tests (`deno task test:all`) to ensure the new test passes and that no existing tests have been broken.
6.  **Format and Lint:** Run `deno fmt` and `deno lint` to ensure code quality and consistency.

- **Test Style:** Tests are written in Japanese and follow a Behavior-Driven Development (BDD) style, using `describe` and `it` blocks from `jsr:@std/testing/bdd`. For detailed guidelines on test structure, file organization (unit vs. integration), and mocking strategies, please refer to the [Testing Style Guide](./docs/TESTING_STYLE.md).
- **File Location:** The location of test files depends on their type. Refer to the [Testing Style Guide](./docs/TESTING_STYLE.md) for details.
- **Project Structure:** The project is divided into `api` and `bot` workspaces.
- **Specification Document:** The `SPEC.md` file contains the detailed project specification and should be consulted for in-depth understanding.
