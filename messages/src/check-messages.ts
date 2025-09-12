import * as path from "jsr:@std/path@^1.1.2";

const CWD = Deno.cwd();
const MESSAGES_DIR = path.join(CWD, "messages");

const SOURCE_FILE = path.join(MESSAGES_DIR, "ja", "system.json");
const TARGET_FILES = [
  path.join(MESSAGES_DIR, "ja", "teemo.json"),
  path.join(MESSAGES_DIR, "en", "system.json"),
  path.join(MESSAGES_DIR, "en", "teemo.json"),
];

function loadJson(filePath: string): Record<string, unknown> {
  try {
    const content = Deno.readTextFileSync(filePath);
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading JSON from ${filePath}:`, error);
    Deno.exit(1);
  }
}

function get(obj: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce((acc: unknown, key): unknown => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function getAllKeys(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return getAllKeys(value as Record<string, unknown>, newKey);
    }
    return newKey;
  });
}

function main() {
  console.log(`Source of truth: ${path.relative(CWD, SOURCE_FILE)}`);
  const sourceMessages = loadJson(SOURCE_FILE);
  const sourceKeys = getAllKeys(sourceMessages);
  let missingKeysFound = false;

  for (const targetFile of TARGET_FILES) {
    console.log(`\nChecking: ${path.relative(CWD, targetFile)}`);
    const targetMessages = loadJson(targetFile);
    let missingCount = 0;

    for (const key of sourceKeys) {
      const value = get(targetMessages, key);
      if (value === undefined) {
        missingKeysFound = true;
        missingCount++;
        console.warn(`  -  Missing key: ${key}`);
      }
    }

    if (missingCount === 0) {
      console.log("  ✅ All keys are present.");
    } else {
      console.error(
        `  ❌ Found ${missingCount} missing key(s).`,
      );
    }
  }

  if (missingKeysFound) {
    console.error(
      "\nSome message files are out of sync with the source of truth.",
    );
    Deno.exit(1);
  } else {
    console.log("\n✨ All message files are in sync!");
  }
}

if (import.meta.main) {
  main();
}
