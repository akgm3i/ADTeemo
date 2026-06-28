export function isRuntimeCommandFile(name: string): boolean {
  return name.endsWith(".ts") &&
    !name.endsWith(".test.ts") &&
    !name.startsWith("link-riot-account");
}
