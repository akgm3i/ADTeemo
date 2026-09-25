import { z } from "zod";
import { lanes } from "./domain.ts";

export const customGameSettingsSchema = z.object({
  recruitmentChannelId: z.string().min(1),
  lobbyChannelId: z.string().min(1),
  redChannelId: z.string().min(1),
  blueChannelId: z.string().min(1),
  roleIds: z.record(z.enum(lanes), z.string().min(1)),
}).refine(
  (settings) =>
    new Set([
      settings.lobbyChannelId,
      settings.redChannelId,
      settings.blueChannelId,
    ]).size === 3,
  {
    message: "Lobby and team voice channels must differ",
    path: ["redChannelId"],
  },
);
export type CustomGameSettings = z.infer<typeof customGameSettingsSchema>;
