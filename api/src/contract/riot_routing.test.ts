import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import {
  canonicalRiotPlatform,
  currentRiotPlatforms,
  riotPlatformForMatchId,
  riotRegionForPlatform,
} from "./riot_routing.ts";
import { linkByRiotIdSchema, loginUrlQuerySchema } from "./schemas.ts";

test("登録入力は現行platformと一致し、地域はplatformから導出する", () => {
  for (const platform of currentRiotPlatforms) {
    const input = {
      discordId: "owner",
      gameName: "Teemo",
      tagLine: "tag",
      platform,
    };
    assertEquals(linkByRiotIdSchema.safeParse(input).success, true);
    assertEquals(
      loginUrlQuerySchema.parse({
        discordId: "owner",
        guildId: "guild",
        platform,
      }).region,
      riotRegionForPlatform(platform),
    );
  }
  for (const platform of ["ph2", "th2"]) {
    assertEquals(
      linkByRiotIdSchema.safeParse({
        discordId: "owner",
        gameName: "Teemo",
        tagLine: "tag",
        platform,
      }).success,
      false,
    );
    assertEquals(
      loginUrlQuerySchema.safeParse({
        discordId: "owner",
        guildId: "guild",
        platform,
      }).success,
      false,
    );
  }
  assertEquals(
    loginUrlQuerySchema.safeParse({
      discordId: "owner",
      guildId: "guild",
      platform: "sg2",
      region: "asia",
    }).success,
    false,
  );
});

test("旧platformの接続先をSG2へ正規化しても過去match IDのplatformは保持する", () => {
  assertEquals(canonicalRiotPlatform("ph2"), "sg2");
  assertEquals(canonicalRiotPlatform("th2"), "sg2");
  assertEquals(riotPlatformForMatchId("PH2_123"), "ph2");
  assertEquals(riotPlatformForMatchId("TH2_123"), "th2");
  assertEquals(riotPlatformForMatchId("jp1x"), undefined);
  assertEquals(riotPlatformForMatchId("JP1_"), undefined);
  assertEquals(riotRegionForPlatform("oc1"), "sea");
  assertEquals(riotRegionForPlatform("sg2"), "sea");
  assertEquals(riotRegionForPlatform("na1"), "americas");
  assertEquals(riotRegionForPlatform("euw1"), "europe");
  assertEquals(riotRegionForPlatform("jp1"), "asia");
});
