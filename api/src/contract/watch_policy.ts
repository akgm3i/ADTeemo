import { z } from "zod";
export const guildMatchWatchSettingsSchema = z.object({
  guildId: z.string().min(1),
  enabled: z.boolean(),
  notificationChannelId: z.string().min(1).nullable(),
}).strict();
export const configureGuildMatchWatchSchema = guildMatchWatchSettingsSchema
  .omit({ guildId: true }).refine(
    (value) => !value.enabled || value.notificationChannelId !== null,
    { message: "Enabled monitoring requires a notification channel" },
  );
export const syncGuildMatchWatchMembersSchema = z.object({
  memberDiscordIds: z.array(z.string().min(1)),
});
export const matchWatchPreferenceSchema = z.object({ optOut: z.boolean() });
