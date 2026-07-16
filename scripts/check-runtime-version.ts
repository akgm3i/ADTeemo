export interface RuntimeVersionFiles {
  dvmrc: string;
  workflow: string;
  dockerfiles: Record<string, string>;
}

const FIXED_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MINIMUM_DENO_VERSION = [2, 5, 0] as const;
const DENO_FROM =
  /^\s*FROM\s+denoland\/deno(?::([^\s]+))?(?:\s+AS\s+\S+)?\s*$/gim;

function isSupportedDenoVersion(version: string): boolean {
  const [major, minor, patch] = version.split("-", 1)[0].split(".").map(Number);
  const actual = [major, minor, patch];
  for (const [index, minimum] of MINIMUM_DENO_VERSION.entries()) {
    if (actual[index] > minimum) return true;
    if (actual[index] < minimum) return false;
  }
  return true;
}

export function validateRuntimeVersionConsistency(
  files: RuntimeVersionFiles,
): string[] {
  const errors: string[] = [];
  const expectedVersion = files.dvmrc.trim();
  const hasFixedVersion = FIXED_SEMVER.test(expectedVersion);

  if (!hasFixedVersion) {
    errors.push(`.dvmrc は固定semverである必要があります: ${expectedVersion}`);
  } else if (!isSupportedDenoVersion(expectedVersion)) {
    errors.push(
      `.dvmrc はDeno 2.5.0以上である必要があります: ${expectedVersion}`,
    );
  }

  if (!/^\s*-?\s*uses:\s*denoland\/setup-deno@v2\s*$/m.test(files.workflow)) {
    errors.push(
      ".github/workflows/quality.yml は denoland/setup-deno@v2 を使用する必要があります",
    );
  }

  if (
    !/^\s*deno-version-file:\s*["']?\.dvmrc["']?\s*$/m.test(
      files.workflow,
    )
  ) {
    errors.push(
      ".github/workflows/quality.yml は deno-version-file: .dvmrc を指定する必要があります",
    );
  }

  for (const [path, source] of Object.entries(files.dockerfiles)) {
    const stages = [...source.matchAll(DENO_FROM)];
    if (stages.length === 0) {
      errors.push(`${path} に denoland/deno のstageがありません`);
      continue;
    }

    if (!hasFixedVersion) continue;

    stages.forEach((stage, index) => {
      const actualVersion = stage[1] ?? "<タグなし>";
      if (actualVersion !== expectedVersion) {
        errors.push(
          `${path} の stage ${
            index + 1
          } は Deno ${actualVersion} を使用しています（期待値: ${expectedVersion}）`,
        );
      }
    });
  }

  return errors;
}

export interface RuntimeVersionCheckDependencies {
  readTextFile(path: string | URL): Promise<string>;
  info(message: string): void;
  error(message: string): void;
  setExitCode(code: number): void;
}

const defaultDependencies: RuntimeVersionCheckDependencies = {
  readTextFile: (path) => Deno.readTextFile(path),
  info: (message) => console.log(message),
  error: (message) => console.error(message),
  setExitCode: (code) => {
    Deno.exitCode = code;
  },
};

export async function checkRepositoryRuntimeVersions(
  dependencies: RuntimeVersionCheckDependencies = defaultDependencies,
): Promise<void> {
  const root = new URL("../", import.meta.url);
  let dvmrc: string;
  let workflow: string;
  let devDockerfile: string;
  let prodDockerfile: string;
  try {
    [dvmrc, workflow, devDockerfile, prodDockerfile] = await Promise.all([
      dependencies.readTextFile(new URL(".dvmrc", root)),
      dependencies.readTextFile(
        new URL(".github/workflows/quality.yml", root),
      ),
      dependencies.readTextFile(new URL("docker/Dockerfile.dev", root)),
      dependencies.readTextFile(new URL("docker/Dockerfile.prod", root)),
    ]);
  } catch (error) {
    const detail = error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "unknown error";
    dependencies.error(
      `Deno runtime設定ファイルを読み込めませんでした: ${detail}`,
    );
    dependencies.setExitCode(1);
    return;
  }
  const errors = validateRuntimeVersionConsistency({
    dvmrc,
    workflow,
    dockerfiles: {
      "docker/Dockerfile.dev": devDockerfile,
      "docker/Dockerfile.prod": prodDockerfile,
    },
  });

  if (errors.length > 0) {
    for (const error of errors) dependencies.error(error);
    dependencies.setExitCode(1);
    return;
  }

  dependencies.info(
    `Deno runtime version is synchronized at ${dvmrc.trim()}.`,
  );
}

if (import.meta.main) await checkRepositoryRuntimeVersions();
