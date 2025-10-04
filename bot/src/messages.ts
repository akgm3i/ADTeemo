import {
  initializeMessages,
  type MessageKey,
  messageKeys,
} from "@adteemo/messages";

// The handler is exported, so its properties can be stubbed.
export const messageHandler = initializeMessages();

// Re-export types and keys for convenience
export { type MessageKey, messageKeys };
