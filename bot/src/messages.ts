import * as path from "@std/path";
import systemMessages from "../../messages/ja/system.json" with { type: "json" };

// Utility type to generate all dot-separated paths of a nested object.
type NestedKey<T> = T extends object ? {
    [K in keyof T]-?: K extends string | number ?
      `${K}` | `${K}.${NestedKey<T[K]>}`
    : never;
  }[keyof T]
  : "";

// Type for all valid message keys, derived from the structure of system.json.
export type MessageKey = NestedKey<typeof systemMessages>;

// TODO: Make language configurable
const lang = "ja";
const theme = Deno.env.get("BOT_MESSAGE_THEME") || "system";

let messages: Record<string, unknown>;

try {
  const filePath = path.join(
    Deno.cwd(),
    "messages",
    lang,
    `${theme}.json`,
  );
  const fileContent = Deno.readTextFileSync(filePath);
  messages = JSON.parse(fileContent);
} catch (error) {
  console.error(`Failed to load message file for theme '${theme}':`, error);
  // Fallback to system theme if the specified theme fails to load
  const fallbackPath = path.join(
    Deno.cwd(),
    "messages",
    lang,
    "system.json",
  );
  const fileContent = Deno.readTextFileSync(fallbackPath);
  messages = JSON.parse(fileContent);
  console.log("Fell back to 'system' theme.");
}

/**
 * Retrieves a message string by its key and replaces placeholders.
 * @param key The key of the message (e.g., "setRiotId.success").
 * @param replacements An object of placeholders to replace (e.g., { riotId: "123" }).
 * @returns The formatted message string.
 */
export function t(
  key: MessageKey,
  replacements?: Record<string, string | number>,
): string {
  const keys = key.split(".");
  let message: unknown = messages;

  for (const k of keys) {
    if (message && typeof message === "object" && k in message) {
      message = (message as Record<string, unknown>)[k];
    } else {
      message = undefined;
      break;
    }
  }

  if (typeof message !== "string") {
    console.warn(`Message key not found: ${key}`);
    return key;
  }

  let finalMessage = message;
  if (replacements) {
    for (const [placeholder, value] of Object.entries(replacements)) {
      finalMessage = finalMessage.replace(
        new RegExp(`\\{${placeholder}\\}`, "g"),
        String(value),
      );
    }
  }

  return finalMessage;
}
