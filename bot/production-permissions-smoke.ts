import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { loadCommands } from "./src/common/command_loader.ts";
import { initializeMessages } from "@adteemo/messages";

export async function verifyProductionPermissions(runtime: boolean) {
  // Check actual permissions before disabling all network access for this smoke.
  for (
    const host of [
      "discord.com:443",
      "gateway.discord.gg:443",
      "gateway-us-east1-b.discord.gg:443",
      "api:8000",
    ]
  ) {
    const status = await Deno.permissions.query({ name: "net", host });
    assertEquals(
      status.state,
      runtime || host === "discord.com:443" ? "granted" : "prompt",
      host,
    );
  }
  for (
    const host of [
      "example.com:443",
      "jp1.api.riotgames.com:443",
      "api:8001",
      "discord.com:80",
      "gateway.discord.gg:80",
      "gateway.discord.gg.evil.example:443",
    ]
  ) {
    assertEquals(
      (await Deno.permissions.query({ name: "net", host })).state,
      "prompt",
      host,
    );
  }
  for (const name of ["write", "sys", "ffi", "run"] as const) {
    assertEquals(
      (await Deno.permissions.query({ name })).state,
      "prompt",
      name,
    );
  }
  for (
    const path of [
      "../data/sqlite.db",
      "../api/src/db/index.ts",
      "../api/src/app.ts",
      "../.env",
    ]
  ) {
    await assertRejects(() => Deno.readTextFile(path), Deno.errors.NotCapable);
  }
  for (
    const name of ["DATABASE_URL", "RIOT_API_KEY", "BOT_SERVICE_TOKEN_PREVIOUS"]
  ) {
    assertThrows(() => Deno.env.get(name), Deno.errors.NotCapable);
  }
  if (!runtime) {
    assertThrows(
      () => Deno.env.get("BOT_SERVICE_TOKEN"),
      Deno.errors.NotCapable,
    );
    assertThrows(() => Deno.env.get("API_URL"), Deno.errors.NotCapable);
  }
  await assertRejects(
    () => fetch("https://example.com/"),
    Deno.errors.NotCapable,
  );
  await Deno.permissions.revoke({ name: "net" });

  // Load real dynamic command modules and dictionaries under the limited read
  // permissions; only external transports are replaced. No Discord registration.
  const commands = await loadCommands();
  if (!commands.ok) {
    for (const error of commands.errors) {
      if (error.code === "IMPORT_FAILED") {
        await import(
          new URL(`./src/commands/${error.fileName}`, import.meta.url).href
        );
      }
    }
  }
  assert(commands.ok, JSON.stringify(commands));
  assert(commands.commands.length > 0);
  for (
    const [lang, theme] of [["ja_JP", "system"], ["ja_JP", "teemo"], [
      "en_US",
      "system",
    ]]
  ) {
    const messages = initializeMessages({ lang, theme });
    const key = "userManagement.setMainRole.success";
    // A catalog read failure must not silently pass through the missing-key fallback.
    const catalog = JSON.parse(
      await Deno.readTextFile(`../messages/${lang}/${theme}.json`),
    );
    assertEquals(
      messages.formatMessage(key),
      catalog.userManagement.setMainRole.success,
    );
  }

  return commands;
}
