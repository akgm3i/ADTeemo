import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  buildOpGgSummonerUrl,
  formatProfileLinks,
} from "./external_profile_links.ts";

describe("external_profile_links.ts", () => {
  test("JP1のRiot IDからOP.GGのサモナーページURLを生成する", () => {
    assertEquals(
      buildOpGgSummonerUrl({
        gameName: "Hide on bush",
        tagLine: "JP1",
        platform: "jp1",
      }),
      "https://www.op.gg/summoners/jp/Hide%20on%20bush-JP1",
    );
  });

  test("URLに使えない文字を含むRiot IDでもOP.GGのパスとしてエンコードする", () => {
    assertEquals(
      buildOpGgSummonerUrl({
        gameName: "てえも/ADC",
        tagLine: "JP#1",
        platform: "jp1",
      }),
      "https://www.op.gg/summoners/jp/%E3%81%A6%E3%81%88%E3%82%82%2FADC-JP%231",
    );
  });

  test("OP.GGで扱う地域へ変換できないplatformの場合、リンクを生成しない", () => {
    assertEquals(
      buildOpGgSummonerUrl({
        gameName: "Teemo",
        tagLine: "PBE",
        platform: "pbe1",
      }),
      null,
    );
  });

  test("Riot IDが空の場合、戦績リンク表示を生成しない", () => {
    assertEquals(
      formatProfileLinks({
        gameName: " ",
        tagLine: "JP1",
        platform: "jp1",
      }),
      null,
    );
  });
});
