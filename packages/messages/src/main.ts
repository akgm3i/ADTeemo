import * as path from "@std/path";
import { z } from "zod";
import systemMessages from "../../../messages/ja/system.json" with {
  type: "json",
};

// Zod schema for a single message entry, which can be a string or a nested object.
type MessageValue = string | { [key: string]: MessageValue };
const messageValueSchema: z.ZodType<MessageValue> = z.lazy(() =>
  z.union([z.string(), z.record(messageValueSchema)])
);

const messagesSchema = z.record(messageValueSchema);

// --- Type generation for type-safe keys ---

// Utility type to generate all dot-separated paths of a nested object.
type NestedKey<T> = T extends object ? {
    [K in keyof T]-?: K extends string | number ?
      `${K}` | `${K}.${NestedKey<T[K]>}`
    : never;
  }[keyof T]
  : "";

// Type for all valid message keys, derived from the structure of system.json.
export type MessageKey = NestedKey<typeof systemMessages>;

// Utility type for the key mirror object.
type NestedKeyObject<T> = {
  [K in keyof T]: T[K] extends object ? NestedKeyObject<T[K]> : MessageKey;
};

// --- Message loading and validation ---

function loadMessages(lang: string, theme: string): z.infer<typeof messagesSchema> {
    const filePath = path.join(Deno.cwd(), "messages", lang, `${theme}.json`);
    try {
        const fileContent = Deno.readTextFileSync(filePath);
        const parsedJson = JSON.parse(fileContent);
        return messagesSchema.parse(parsedJson);
    } catch (error) {
        console.error(`Failed to load or validate message file: ${filePath}`, error);
        // If any file fails, we might not want to start, but for now, we'll return an empty object.
        return {};
    }
}

// TODO: Make language configurable
const lang = "ja";
const theme = Deno.env.get("BOT_MESSAGE_THEME") || "system";

const defaultMessages = loadMessages("ja", "system");
let primaryMessages = defaultMessages;

if (lang !== "ja" || theme !== "system") {
    primaryMessages = loadMessages(lang, theme);
}


// --- Key mirror generation for type-safe access ---

function createKeyMirror<T extends object>(
  obj: T,
  path: string[] = [],
): NestedKeyObject<T> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      const newPath = [...path, key];
      if (typeof value === "object" && value !== null) {
        return [key, createKeyMirror(value, newPath)];
      }
      return [key, newPath.join(".")];
    }),
  ) as NestedKeyObject<T>;
}

export const m = createKeyMirror(systemMessages);

// --- t function ---
function getMessage(messages: Record<string, unknown>, key: string): string | undefined {
    const keys = key.split(".");
    let message: unknown = messages;

    for (const k of keys) {
        if (message && typeof message === "object" && k in message) {
            message = (message as Record<string, unknown>)[k];
        } else {
            return undefined;
        }
    }
    return typeof message === 'string' ? message : undefined;
}

/**
 * Retrieves a message string by its key and replaces placeholders.
 * @param key The key of the message (e.g., m.customGame.create.success).
 * @param replacements An object of placeholders to replace (e.g., { eventName: "My Event" }).
 * @returns The formatted message string.
 */
export function t(
  key: MessageKey,
  replacements?: Record<string, string | number>,
): string {
  let message = getMessage(primaryMessages, key) ?? getMessage(defaultMessages, key);

  if (message === undefined) {
    console.warn(`Message key not found: ${key}`);
    return key;
  }

  if (replacements) {
    for (const [placeholder, value] of Object.entries(replacements)) {
      message = message.replace(
        new RegExp(`\\{${placeholder}\\}`, "g"),
        String(value),
      );
    }
  }

  return message;
}
