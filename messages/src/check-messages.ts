import * as path from "@std/path";
import { get, getAllKeys } from "./object-path.ts";

const CWD = Deno.cwd();
const MESSAGES_DIR = path.join(CWD, "messages");

const SOURCE_FILE = path.join(MESSAGES_DIR, "ja_JP", "system.json");
const TARGET_FILES = [
  path.join(MESSAGES_DIR, "ja_JP", "teemo.json"),
  path.join(MESSAGES_DIR, "en_US", "system.json"),
];

interface LoadedJson {
  data: Record<string, unknown>;
  duplicateKeys: string[];
}

interface JsonObjectFrame {
  type: "object";
  seenKeys: Set<string>;
  expectKey: boolean;
  path: string[];
  pendingKey: string | null;
}

interface JsonArrayFrame {
  type: "array";
  path: string[];
}

type JsonFrame = JsonObjectFrame | JsonArrayFrame;

function readJsonString(content: string, start: number): {
  value: string;
  end: number;
} {
  let value = "";

  for (let index = start + 1; index < content.length; index++) {
    const char = content[index];

    if (char === "\\") {
      const escaped = content[index + 1];
      if (escaped === undefined) break;
      value += char + escaped;
      index++;
      continue;
    }

    if (char === '"') {
      try {
        return {
          value: JSON.parse(content.slice(start, index + 1)),
          end: index,
        };
      } catch {
        return { value, end: index };
      }
    }

    value += char;
  }

  return { value, end: content.length - 1 };
}

function skipWhitespace(content: string, start: number): number {
  let index = start;
  while (/\s/.test(content[index] ?? "")) {
    index++;
  }
  return index;
}

function parentPathForValue(stack: JsonFrame[]): string[] {
  const parent = stack.at(-1);
  if (parent?.type !== "object" || parent.pendingKey === null) {
    return parent?.path ?? [];
  }
  return [...parent.path, parent.pendingKey];
}

function findDuplicateJsonKeys(content: string): string[] {
  const duplicates: string[] = [];
  const stack: JsonFrame[] = [];

  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    const current = stack.at(-1);

    if (char === '"') {
      const key = readJsonString(content, index);
      index = key.end;

      if (current?.type !== "object" || !current.expectKey) {
        continue;
      }

      const nextIndex = skipWhitespace(content, index + 1);
      if (content[nextIndex] !== ":") {
        continue;
      }

      const duplicatePath = [...current.path, key.value].join(".");
      if (current.seenKeys.has(key.value)) {
        duplicates.push(duplicatePath);
      } else {
        current.seenKeys.add(key.value);
      }
      current.expectKey = false;
      current.pendingKey = key.value;
      index = nextIndex;
      continue;
    }

    if (char === "{") {
      stack.push({
        type: "object",
        seenKeys: new Set(),
        expectKey: true,
        path: parentPathForValue(stack),
        pendingKey: null,
      });
      continue;
    }

    if (char === "[") {
      stack.push({ type: "array", path: parentPathForValue(stack) });
      continue;
    }

    if (char === "}" || char === "]") {
      stack.pop();
      continue;
    }

    if (char === "," && current?.type === "object") {
      current.expectKey = true;
      current.pendingKey = null;
    }
  }

  return duplicates;
}

function loadJson(filePath: string): LoadedJson | null {
  try {
    const content = Deno.readTextFileSync(filePath);
    const duplicateKeys = findDuplicateJsonKeys(content);
    return { data: JSON.parse(content), duplicateKeys };
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
  const sourceKeys = getAllKeys(sourceMessages.data);
  let missingKeysFound = false;
  let duplicateKeysFound = false;
  let filesSkipped = false;

  if (sourceMessages.duplicateKeys.length > 0) {
    duplicateKeysFound = true;
    console.error(
      `  ❌ Found duplicate key(s): ${sourceMessages.duplicateKeys.join(", ")}`,
    );
  }

  for (const targetFile of TARGET_FILES) {
    console.log(`Checking: ${path.relative(CWD, targetFile)}`);
    const targetMessages = loadJson(targetFile);

    if (targetMessages === null) {
      console.warn(`  - File not found, skipping.`);
      filesSkipped = true;
      continue;
    }

    if (targetMessages.duplicateKeys.length > 0) {
      duplicateKeysFound = true;
      console.error(
        `  ❌ Found duplicate key(s): ${
          targetMessages.duplicateKeys.join(", ")
        }`,
      );
    }

    let missingCount = 0;

    for (const key of sourceKeys) {
      const value = get(targetMessages.data, key);
      if (value === undefined) {
        missingKeysFound = true;
        missingCount++;
        console.warn(`  -  Missing key: ${key}`);
      }
    }

    if (missingCount > 0) {
      console.error(
        `  ❌ Found ${missingCount} missing key(s).`,
      );
    } else if (targetMessages.duplicateKeys.length === 0) {
      console.log("  ✅ All keys are present.");
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

  if (duplicateKeysFound) {
    console.error("\n❌ Some message files contain duplicate keys.");
  }

  if (missingKeysFound || duplicateKeysFound || filesSkipped) {
    Deno.exit(1);
  } else {
    console.log("\n✨ All message files are in sync!");
  }
}

if (import.meta.main) {
  main();
}
