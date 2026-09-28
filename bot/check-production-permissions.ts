// Use the same tasks as Docker in fresh processes: regular tests intentionally
// have broader filesystem permissions for repository integration tests.
const cacheInfo = await new Deno.Command(Deno.execPath(), {
  args: ["info", "--json"],
  stdout: "piped",
  stderr: "inherit",
}).output();
if (!cacheInfo.success) Deno.exit(cacheInfo.code);
const { denoDir } = JSON.parse(new TextDecoder().decode(cacheInfo.stdout)) as {
  denoDir: string;
};

for (
  const [profile, smoke] of [
    ["run:prod", "runtime-permissions-smoke.ts"],
    ["run:deploy", "deploy-permissions-smoke.ts"],
  ]
) {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: new URL("./", import.meta.url),
    args: [
      "task",
      "--quiet",
      profile,
      "--check",
      "--env-file=../.env.example",
      smoke,
    ],
    clearEnv: true,
    env: {
      DENO_DIR: denoDir,
      API_URL: "http://api:8000",
      BOT_SERVICE_TOKEN: "permission-smoke-token-0000000000000000",
    },
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!output.success) Deno.exit(output.code);
}
