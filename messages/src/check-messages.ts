import * as path from "@std/path";
import { get, getAllKeys } from "./object-path.ts";

const CWD = Deno.cwd();
const MESSAGES_DIR = path.join(CWD, "messages");

const SOURCE_FILE = path.join(MESSAGES_DIR, "ja", "system.json");
const TARGET_FILES = [
  path.join(MESSAGES_DIR, "ja", "teemo.json"),
  path.join(MESSAGES_DIR, "en", "system.json"),
  path.join(MESSAGES_DIR, "en", "teemo.json"),
];

function loadJson(filePath: string): Record<string, unknown> | null {
  try {
    const content = Deno.readTextFileSync(filePath);
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    console.error(`Error processing file ${filePath}:`, error);
    Deno.exit(1);
  }
}

export function main() {
  console.log(`Source of truth: ${path.relative(CWD, SOURCE_FILE)}`);
  const sourceMessages = loadJson(SOURCE_FILE);
  if (sourceMessages === null) {
    console.error(
      `❌ Source file not found, stopping: ${path.relative(CWD, SOURCE_FILE)}`,
    );
    Deno.exit(1);
  }
  const sourceKeys = getAllKeys(sourceMessages);
  let missingKeysFound = false;
  let filesSkipped = false;

  for (const targetFile of TARGET_FILES) {
    console.log(`Checking: ${path.relative(CWD, targetFile)}`);
    const targetMessages = loadJson(targetFile);

    if (targetMessages === null) {
      console.warn(`  - File not found, skipping.`);
      filesSkipped = true;
      continue;
    }

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
      "\n❌ Some message files are out of sync with the source of truth.",
    );
  }

  if (filesSkipped) {
    console.error("\n❌ Some target files were not found and were skipped.");
  }

  if (missingKeysFound || filesSkipped) {
    Deno.exit(1);
  } else {
    console.log("\n✨ All message files are in sync!");
  }
}

if (import.meta.main) {
  main();
}
