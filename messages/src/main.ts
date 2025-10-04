import * as path from "@std/path";
import { z } from "zod";
import systemMessages from "../ja/system.json" with {
  type: "json",
};
import { get as getMessageValue } from "./object-path.ts";

// Zod schema for a single message entry, which can be a string or a nested object.
type MessageValue = string | { [key: string]: MessageValue };
const messageValueSchema: z.ZodType<MessageValue> = z.lazy(() =>
  z.union([z.string(), z.record(messageValueSchema)])
);

const messagesSchema = z.record(messageValueSchema);

// --- Type generation for type-safe keys ---

// Utility type to generate all dot-separated paths of a nested object.
type NestedKey<T> = T extends object ? {
    [K in keyof T]-?: K extends string | number
      ? `${K}` | `${K}.${NestedKey<T[K]>}`
      : never;
  }[keyof T]
  : "";

// Type for all valid message keys, derived from the structure of system.json.
export type MessageKey = NestedKey<typeof systemMessages>;

// Utility type for the key mirror object.
type NestedKeyObject<T> = {
  [K in keyof T]: T[K] extends object ? NestedKeyObject<T[K]> : MessageKey;
};

/**
 * A type that mirrors the structure of the message files, providing type-safe access to message keys.
 * This explicit type can help IDEs with intellisense and type resolution.
 */
export type MessageKeys = NestedKeyObject<typeof systemMessages>;

// --- Message loading and validation ---

function loadMessages(
  lang: string,
  theme: string,
): z.infer<typeof messagesSchema> {
  // Use import.meta.url to create a path relative to this file, not the CWD.
  const projectRoot = path.fromFileUrl(new URL("../..", import.meta.url));
  const filePath = path.join(projectRoot, "messages", lang, `${theme}.json`);

  try {
    const fileContent = Deno.readTextFileSync(filePath);
    const parsedJson = JSON.parse(fileContent);
    return messagesSchema.parse(parsedJson);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Return empty object if file not found, so fallback can be used.
      return {};
    }
    console.error(
      `Failed to load or validate message file: ${filePath}`,
      error,
    );
    return {};
  }
}

interface InitializeMessagesOptions {
  lang: string;
  theme?: string;
}

export function initializeMessages(
  options: InitializeMessagesOptions = { lang: "ja" },
) {
  const { lang } = options;
  const theme = options.theme ?? Deno.env.get("BOT_MESSAGE_THEME") ?? "system";

  const defaultMessages = loadMessages("ja", "system");

  const langSystemMessages = (lang === "ja")
    ? defaultMessages
    : loadMessages(lang, "system");

  const themeMessages = (theme && theme !== "system")
    ? loadMessages(lang, theme)
    : {};

  function getMessage(
    messages: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const message = getMessageValue(messages, key);
    return typeof message === "string" ? message : undefined;
  }

  /**
   * Retrieves a message string by its key and replaces placeholders.
   * @param key The key of the message (e.g., messageKeys.customGame.create.success).
   * @param replacements An object of placeholders to replace (e.g., { eventName: "My Event" }).
   * @returns The formatted message string.
   */
  function formatMessage(
    key: MessageKey,
    replacements?: Record<string, string | number>,
  ): string {
    let message = getMessage(themeMessages, key) ??
      getMessage(langSystemMessages, key) ??
      getMessage(defaultMessages, key);

    if (message === undefined) {
      console.warn(`Message key not found: ${key}`);
      return key;
    }

    if (replacements) {
      for (const [placeholder, value] of Object.entries(replacements)) {
        message = message.replace(
          new RegExp(`{${placeholder}}`, "g"),
          String(value),
        );
      }
    }

    return message;
  }

  return { formatMessage };
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

export const messageKeys: MessageKeys = createKeyMirror(systemMessages);
