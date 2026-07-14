import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { SlashCommandBuilder } from "discord.js";
import {
  type CommandLoaderDependencies,
  loadCommands,
} from "./command_loader.ts";
import type { CommandRegistration } from "./command_registry.ts";
import { enabledCommandRegistrations } from "./command_registry.ts";

function commandModule(name: string) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(
      `${name} command`,
    ),
    execute: () => Promise.resolve(),
  };
}

function dependencies(
  registry: readonly CommandRegistration[],
  modules: Record<string, unknown>,
  files = registry.map((entry) => entry.fileName),
): CommandLoaderDependencies {
  return {
    registry,
    listCommandFiles: () => Promise.resolve(files),
    importCommand: (fileName) => {
      if (!(fileName in modules)) {
        return Promise.reject(new Error(`missing module: ${fileName}`));
      }
      return Promise.resolve(modules[fileName]);
    },
  };
}

describe("command loader", () => {
  test("実commandと公開READMEがregistryの有効command一覧に一致する", async () => {
    const result = await loadCommands();
    assertEquals(result.ok, true);
    if (!result.ok) return;

    const enabledNames = enabledCommandRegistrations()
      .map((entry) => entry.expectedName)
      .sort();
    assertEquals(
      result.commands.map((command) => command.data.name),
      enabledNames,
    );

    const readme = await Deno.readTextFile(
      new URL("../../../README.md", import.meta.url),
    );
    const documentedNames = [...readme.matchAll(/^\| `\/([a-z0-9-]+)/gm)]
      .map((match) => match[1])
      .sort();
    assertEquals(documentedNames, enabledNames);

    const spec = await Deno.readTextFile(
      new URL("../../../SPEC.md", import.meta.url),
    );
    assertStringIncludes(
      spec,
      "`/link-riot-account` は #117 でcanonical Riot account modelへ接続するまで未提供",
    );
  });

  test("全commandが有効なとき、name順の完全な一覧を返す", async () => {
    const registry = [
      { fileName: "zeta.ts", expectedName: "zeta", status: "enabled" },
      { fileName: "alpha.ts", expectedName: "alpha", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "alpha.ts": commandModule("alpha"),
      "zeta.ts": commandModule("zeta"),
    }));

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.commands.map((command) => command.data.name), [
        "alpha",
        "zeta",
      ]);
    }
  });

  test("1commandのimportに失敗したとき、部分的なcommandsを公開しない", async () => {
    const registry = [
      { fileName: "good.ts", expectedName: "good", status: "enabled" },
      { fileName: "broken.ts", expectedName: "broken", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "good.ts": commandModule("good"),
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), ["IMPORT_FAILED"]);
      assertFalse("commands" in result);
    }
  });

  test("dataまたはexecuteが欠けるとき、loader全体を失敗させる", async () => {
    const registry = [
      {
        fileName: "missing-data.ts",
        expectedName: "missing-data",
        status: "enabled",
      },
      {
        fileName: "missing-execute.ts",
        expectedName: "missing-execute",
        status: "enabled",
      },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "missing-data.ts": { execute: () => Promise.resolve() },
      "missing-execute.ts": {
        data: new SlashCommandBuilder().setName("missing-execute")
          .setDescription("missing execute command"),
      },
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), [
        "INVALID_MODULE",
        "INVALID_MODULE",
      ]);
    }
  });

  test("dataがSlashCommandBuilderでないとき、schema不正として全体を失敗させる", async () => {
    const registry = [
      { fileName: "plain.ts", expectedName: "plain", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "plain.ts": {
        data: {
          toJSON: () => ({ name: "plain", description: "plain command" }),
        },
        execute: () => Promise.resolve(),
      },
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), [
        "INVALID_SCHEMA",
      ]);
    }
  });

  test("builderのschemaが未完成なとき、部分的なcommandsを公開しない", async () => {
    const registry = [
      { fileName: "invalid.ts", expectedName: "invalid", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "invalid.ts": {
        data: new SlashCommandBuilder(),
        execute: () => Promise.resolve(),
      },
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), [
        "INVALID_SCHEMA",
      ]);
    }
  });

  test("registryとcommand nameが異なるとき、name不一致として全体を失敗させる", async () => {
    const registry = [
      {
        fileName: "renamed.ts",
        expectedName: "expected-name",
        status: "enabled",
      },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "renamed.ts": commandModule("actual-name"),
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), [
        "NAME_MISMATCH",
      ]);
    }
  });

  test("command nameが重複するとき、loader全体を失敗させる", async () => {
    const registry = [
      { fileName: "first.ts", expectedName: "same", status: "enabled" },
      { fileName: "second.ts", expectedName: "same", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "first.ts": commandModule("same"),
      "second.ts": commandModule("same"),
    }));

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(
        result.errors.some((error) => error.code === "DUPLICATE_NAME"),
        true,
      );
    }
  });

  test("registry外のcommand fileがあるとき、暗黙にloadせず失敗する", async () => {
    const registry = [
      { fileName: "known.ts", expectedName: "known", status: "enabled" },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(
      dependencies(
        registry,
        { "known.ts": commandModule("known") },
        ["known.ts", "unknown.ts"],
      ),
    );

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.errors.map((error) => error.code), [
        "REGISTRY_MISMATCH",
      ]);
    }
  });

  test("disabled commandはregistry整合性を満たすがimportしない", async () => {
    const registry = [
      { fileName: "enabled.ts", expectedName: "enabled", status: "enabled" },
      {
        fileName: "disabled.ts",
        expectedName: "disabled",
        status: "disabled",
        disabledReason: "not released",
      },
    ] satisfies readonly CommandRegistration[];

    const result = await loadCommands(dependencies(registry, {
      "enabled.ts": commandModule("enabled"),
    }));

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.commands.map((command) => command.data.name), [
        "enabled",
      ]);
    }
  });
});
