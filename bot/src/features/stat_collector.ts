import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { CustomMatchStat } from "../api_client.ts";
import { messageHandler, messageKeys } from "../messages.ts";

type ReplyInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | ModalSubmitInteraction;
export type StatParticipant = {
  user: { id: string; username: string };
  lane: string;
};
export type StatCollectionResult =
  | { status: "complete"; stats: CustomMatchStat[] }
  | { status: "cancelled" | "expired" }
  | { status: "failure"; error: unknown };
type ButtonResult =
  | { status: "value"; button: ButtonInteraction }
  | { status: "cancelled" | "expired" };

const INPUT_TIMEOUT_MS = 2 * 60_000;
const RESUME_TIMEOUT_MS = 10 * 60_000;
const SESSION_TIMEOUT_MS = 60 * 60_000;
// Leave time to display the retained draft before the 15-minute token expiry.
const REPLY_LIFETIME_MS = 14 * 60_000;
const keys = messageKeys.matchManagement.recordMatch;

function collectorTimedOut(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "InteractionCollectorError" &&
    typeof candidate.message === "string" &&
    candidate.message.endsWith("reason: time");
}

export function createStatSession(
  interaction: ChatInputCommandInteraction,
  context: { eventId: number; gameSequence: number; winner: string },
) {
  let reply: ReplyInteraction = interaction;
  const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
  const summary = new EmbedBuilder().setTitle(
    messageHandler.formatMessage(keys.summaryTitle),
  ).setDescription(messageHandler.formatMessage(keys.sessionContext, context));

  async function render(content: string, buttons: ButtonBuilder[] = []) {
    return await reply.editReply({
      content,
      embeds: [summary],
      components: buttons.length
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]
        : [],
    });
  }

  async function accept(next: ButtonInteraction | ModalSubmitInteraction) {
    await next.deferUpdate();
    reply = next;
  }

  function remainingTime() {
    return Math.min(
      expiresAt,
      reply.createdTimestamp + REPLY_LIFETIME_MS,
    ) - Date.now();
  }

  async function waitForButton(
    content: string,
    actionId: string,
    label: string,
  ): Promise<ButtonResult> {
    for (const paused of [false, true]) {
      if (remainingTime() <= 0) return { status: "expired" };
      const message = await render(
        paused
          ? messageHandler.formatMessage(
            actionId === "confirm_record_match"
              ? keys.confirmationPaused
              : keys.paused,
          )
          : content,
        [
          new ButtonBuilder().setCustomId(actionId).setLabel(
            paused && actionId !== "confirm_record_match"
              ? messageHandler.formatMessage(keys.resumeButton)
              : label,
          ).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("cancel_record_match").setLabel(
            messageHandler.formatMessage(keys.cancelButton),
          ).setStyle(ButtonStyle.Danger),
        ],
      );
      const remaining = remainingTime();
      if (remaining <= 0) return { status: "expired" };
      try {
        const button = await message.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (candidate) =>
            candidate.user.id === interaction.user.id &&
            (candidate.customId === actionId ||
              candidate.customId === "cancel_record_match"),
          time: Math.min(
            paused ? RESUME_TIMEOUT_MS : INPUT_TIMEOUT_MS,
            remaining,
          ),
        });
        if (button.customId === "cancel_record_match") {
          await accept(button);
          return { status: "cancelled" };
        }
        return { status: "value", button };
      } catch (error) {
        if (!collectorTimedOut(error)) throw error;
        if (paused || remainingTime() <= 0) return { status: "expired" };
      }
    }
    return { status: "expired" };
  }

  return {
    id: interaction.id,
    ownerId: interaction.user.id,
    summary,
    render,
    accept,
    remainingTime,
    waitForButton,
  };
}
export type StatSession = ReturnType<typeof createStatSession>;

type StatDraft = { kda: string; cs: string; gold: string };

export function parseStatDraft(draft: StatDraft) {
  if (!/^\d+\/\d+\/\d+$/.test(draft.kda)) return null;
  if (!/^\d+$/.test(draft.cs) || !/^\d+$/.test(draft.gold)) return null;
  const [kills, deaths, assists] = draft.kda.split("/").map(Number);
  const cs = Number(draft.cs);
  const gold = Number(draft.gold);
  if (![kills, deaths, assists, cs, gold].every(Number.isSafeInteger)) {
    return null;
  }
  return { kills, deaths, assists, cs, gold };
}

function statsModal(id: string, username: string, draft: StatDraft) {
  const modal = new ModalBuilder().setCustomId(id).setTitle(
    messageHandler.formatMessage(keys.modalTitle, { username }).slice(0, 45),
  );
  for (
    const [field, label, placeholder] of [
      ["kda", "K / D / A", "10/2/8"],
      ["cs", "CS", "200"],
      ["gold", "Gold", "12000"],
    ] as const
  ) {
    const input = new TextInputBuilder().setCustomId(field).setLabel(label)
      .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      .setPlaceholder(placeholder);
    if (draft[field]) input.setValue(draft[field]);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
  }
  return modal;
}

async function collectStats(
  session: StatSession,
  participants: StatParticipant[],
): Promise<StatCollectionResult> {
  const stats: CustomMatchStat[] = [];
  const fields: Array<{ name: string; value: string }> = [];
  try {
    for (const participant of participants) {
      let draft: StatDraft = { kda: "", cs: "", gold: "" };
      let notice = messageHandler.formatMessage(keys.promptStats, {
        username: participant.user.username,
      });
      while (true) {
        const action = await session.waitForButton(
          notice,
          "input_record_match",
          messageHandler.formatMessage(keys.inputButton),
        );
        if (action.status !== "value") return action;
        const modalId =
          `record_match:${session.id}:${action.button.id}:${participant.user.id}`;
        await action.button.showModal(
          statsModal(modalId, participant.user.username, draft),
        );
        let submission: ModalSubmitInteraction;
        try {
          submission = await action.button.awaitModalSubmit({
            time: Math.min(
              INPUT_TIMEOUT_MS,
              Math.max(1, session.remainingTime()),
            ),
            filter: (candidate) =>
              candidate.customId === modalId &&
              candidate.user.id === session.ownerId,
          });
        } catch (error) {
          if (!collectorTimedOut(error)) throw error;
          notice = messageHandler.formatMessage(keys.paused);
          continue;
        }
        await session.accept(submission);
        draft = {
          kda: submission.fields.getTextInputValue("kda").trim(),
          cs: submission.fields.getTextInputValue("cs").trim(),
          gold: submission.fields.getTextInputValue("gold").trim(),
        };
        const field = {
          name: `${participant.user.username} (${participant.lane})`,
          value: `${draft.kda} - ${draft.cs}cs - ${draft.gold}g`,
        };
        session.summary.setFields([...fields, field]);
        const parsed = parseStatDraft(draft);
        if (!parsed) {
          notice = messageHandler.formatMessage(keys.invalidStats);
          continue;
        }
        stats.push({ userId: participant.user.id, ...parsed });
        fields.push(field);
        break;
      }
    }
    return { status: "complete", stats };
  } catch (error) {
    return { status: "failure", error };
  }
}

export const statCollector = { collectStats };
