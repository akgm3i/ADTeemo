import { assert, assertEquals, assertFalse } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { parse } from "@std/yaml";

const root = new URL("../", import.meta.url);

describe("Bot production permission profiles", () => {
  test("Botと配備をproductionで起動するとき、用途別の制限付きprofileを使用する", async () => {
    // Arrange
    const config = JSON.parse(
      await Deno.readTextFile(new URL("bot/deno.json", root)),
    ) as { tasks: Record<string, string> };
    const dockerfile = await Deno.readTextFile(
      new URL("docker/Dockerfile.prod", root),
    );
    const compose = parse(
      await Deno.readTextFile(new URL("docker-compose.yml", root)),
    ) as { services: Record<string, { command?: string[] }> };

    // Act
    const botStage = dockerfile.split(" AS bot\n")[1];
    const cmd = botStage.match(/^CMD (.+)$/m)?.[1];

    // Assert
    assert(cmd);
    assertEquals(JSON.parse(cmd), ["deno", "task", "run:prod", "src/main.ts"]);
    assertEquals(compose.services.bot.command, undefined);
    assertEquals(compose.services["command-deployer"].command, [
      "deno",
      "task",
      "run:deploy",
      "src/deploy-commands.ts",
    ]);
    for (const name of ["run:prod", "run:deploy"]) {
      const profile = config.tasks[name];
      assert(profile, `${name} profile is required`);
      const args = profile.replaceAll('"', "").split(/\s+/);
      assertEquals(args.slice(0, 2), ["deno", "run"]);
      assert(args.includes("--no-prompt"));
      assert(args.includes("--cached-only"));
      assert(args.includes("--frozen"));
      assertFalse(args.includes("-A"));
      assertFalse(args.includes("--allow-all"));
      const resources = (permission: string) =>
        args
          .find((arg) => arg.startsWith(`--allow-${permission}=`))
          ?.split("=")[1].split(",").sort();
      assertEquals(
        resources("net"),
        name === "run:prod"
          ? ["*.discord.gg:443", "api:8000", "discord.com:443"]
          : ["discord.com:443"],
      );
      assertEquals(
        resources("read"),
        name === "run:prod"
          ? ["../messages", "src"]
          : ["../api/src/contract", "../lib/http", "../messages", "src"],
      );
      for (const arg of args.filter((arg) => arg.startsWith("--allow-"))) {
        assert(/^--allow-(net|env|read)=\S+$/.test(arg), arg);
      }
    }
  });

  test("root taskからコマンドを配備するとき、環境ファイルだけを切り替えて配備用profileを共有する", async () => {
    // Arrange
    const config = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", root)),
    ) as { tasks: Record<string, string | { dependencies: string[] }> };

    // Act / Assert
    assertEquals(
      config.tasks["deploy-commands"],
      "deno task --cwd=bot run:deploy --env-file=../.env src/deploy-commands.ts",
    );
    assertEquals(
      config.tasks["dev:deploy-commands"],
      "deno task --cwd=bot run:deploy --env-file=../.env.dev src/deploy-commands.ts",
    );
    assert((config.tasks.quality as { dependencies: string[] }).dependencies
      .includes("check:bot-permissions"));
  });
});
