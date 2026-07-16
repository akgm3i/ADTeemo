import { assertEquals } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import {
  checkRepositoryRuntimeVersions,
  validateRuntimeVersionConsistency,
} from "./check-runtime-version.ts";

describe("validateRuntimeVersionConsistency", () => {
  test("workflowが.dvmrcを参照し、Dockerの全stageが同じversionの場合、設定不整合を返さない", () => {
    // Arrange
    const files = {
      dvmrc: "2.5.7\n",
      workflow: `
        - uses: denoland/setup-deno@v2
          with:
            deno-version-file: .dvmrc
            cache: true
      `,
      dockerfiles: {
        "docker/Dockerfile.dev": "FROM denoland/deno:2.5.7\n",
        "docker/Dockerfile.prod": `
          FROM denoland/deno:2.5.7 AS builder
          FROM denoland/deno:2.5.7 AS api
          FROM denoland/deno:2.5.7 AS bot
        `,
      },
    };

    // Act
    const errors = validateRuntimeVersionConsistency(files);

    // Assert
    assertEquals(errors, []);
  });

  test("Dockerのstageがlatestまたは別versionの場合、各stageの不整合を返す", () => {
    // Arrange
    const files = {
      dvmrc: "2.5.7\n",
      workflow: `
        - uses: denoland/setup-deno@v2
          with:
            deno-version-file: .dvmrc
      `,
      dockerfiles: {
        "docker/Dockerfile.dev": "FROM denoland/deno:latest\n",
        "docker/Dockerfile.prod": `
          FROM denoland/deno:2.5.7 AS builder
          FROM denoland/deno:2.5.8 AS api
          FROM denoland/deno:latest AS bot
        `,
      },
    };

    // Act
    const errors = validateRuntimeVersionConsistency(files);

    // Assert
    assertEquals(errors, [
      "docker/Dockerfile.dev の stage 1 は Deno latest を使用しています（期待値: 2.5.7）",
      "docker/Dockerfile.prod の stage 2 は Deno 2.5.8 を使用しています（期待値: 2.5.7）",
      "docker/Dockerfile.prod の stage 3 は Deno latest を使用しています（期待値: 2.5.7）",
    ]);
  });

  test("workflowが.dvmrcを参照しない場合、version設定の不整合を返す", () => {
    // Arrange
    const files = {
      dvmrc: "2.5.7\n",
      workflow: `
        - uses: denoland/setup-deno@v2
          with:
            deno-version: 2.5.7
      `,
      dockerfiles: {
        "docker/Dockerfile.dev": "FROM denoland/deno:2.5.7\n",
        "docker/Dockerfile.prod": "FROM denoland/deno:2.5.7 AS builder\n",
      },
    };

    // Act
    const errors = validateRuntimeVersionConsistency(files);

    // Assert
    assertEquals(errors, [
      ".github/workflows/quality.yml は deno-version-file: .dvmrc を指定する必要があります",
    ]);
  });

  test(".dvmrcが固定semverでない場合、version設定の不整合だけを返す", () => {
    // Arrange
    const files = {
      dvmrc: "latest\n",
      workflow: `
        - uses: denoland/setup-deno@v2
          with:
            deno-version-file: .dvmrc
      `,
      dockerfiles: {
        "docker/Dockerfile.dev": "FROM denoland/deno:latest\n",
        "docker/Dockerfile.prod": "FROM denoland/deno:latest AS builder\n",
      },
    };

    // Act
    const errors = validateRuntimeVersionConsistency(files);

    // Assert
    assertEquals(errors, [
      ".dvmrc は固定semverである必要があります: latest",
    ]);
  });

  test(".dvmrcがDeno 2.5未満の場合、対応runtime範囲外として不整合を返す", () => {
    // Arrange
    const files = {
      dvmrc: "2.4.9\n",
      workflow: `
        - uses: denoland/setup-deno@v2
          with:
            deno-version-file: .dvmrc
      `,
      dockerfiles: {
        "docker/Dockerfile.dev": "FROM denoland/deno:2.4.9\n",
        "docker/Dockerfile.prod": "FROM denoland/deno:2.4.9 AS builder\n",
      },
    };

    // Act
    const errors = validateRuntimeVersionConsistency(files);

    // Assert
    assertEquals(errors, [
      ".dvmrc はDeno 2.5.0以上である必要があります: 2.4.9",
    ]);
  });
});

describe("checkRepositoryRuntimeVersions", () => {
  test("設定ファイルの読み込みに失敗したとき、簡潔な診断を出してexit code 1を設定する", async () => {
    // Arrange
    const errors: string[] = [];
    const infos: string[] = [];
    const exitCodes: number[] = [];

    // Act
    await checkRepositoryRuntimeVersions({
      readTextFile: () =>
        Promise.reject(new Deno.errors.NotFound("quality.yml is missing")),
      info: (message) => infos.push(message),
      error: (message) => errors.push(message),
      setExitCode: (code) => exitCodes.push(code),
    });

    // Assert
    assertEquals(infos, []);
    assertEquals(errors, [
      "Deno runtime設定ファイルを読み込めませんでした: quality.yml is missing",
    ]);
    assertEquals(exitCodes, [1]);
  });
});
