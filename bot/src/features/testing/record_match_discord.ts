import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import { strictFake } from "./strict_fake.ts";

export type RecordMatchDiscordStep =
  | {
    action: "input";
    userId: string;
    draft?: { kda: string; cs: string; gold: string };
    inputMs?: number;
    modalTimeout?: boolean;
    waitMs?: number;
  }
  | { action: "confirm" | "cancel"; waitMs?: number }
  | { action: "timeout" | "failure" };

const collectorTimeout = () => ({
  code: "InteractionCollectorError",
  message: "Collector received no interactions before ending with reason: time",
});

type ButtonOptions = {
  time: number;
  filter: (value: ButtonInteraction) => boolean;
};
type ModalOptions = {
  time: number;
  filter: (value: ModalSubmitInteraction) => boolean;
};

/** Script only Discord events and token validity; do not reproduce session decisions. */
export function recordMatchDiscord(
  interaction: ChatInputCommandInteraction,
  steps: RecordMatchDiscordStep[],
  tick: (ms: number) => void = () => {},
) {
  const cleanup = new DisposableStack();
  const edits: Array<
    {
      token: string;
      body: {
        content?: string | null;
        embeds: unknown[];
        components: unknown[];
      };
    }
  > = [];
  const modals: ReturnType<ModalBuilder["toJSON"]>[] = [];
  const acknowledgements: string[] = [];
  const buttons = cleanup.use(
    strictFake<[ButtonOptions], RecordMatchDiscordStep>(
      "awaitMessageComponent",
      steps.map((value) => ({
        value,
        check: (options: ButtonOptions) => {
          if (value.action === "timeout" || value.action === "failure") return;
          const candidate = {
            user: interaction.user,
            customId: value.action === "input"
              ? "input_record_match"
              : `${value.action}_record_match`,
          } as ButtonInteraction;
          assertEquals(
            options.filter(
              { ...candidate, user: { id: "outsider" } } as ButtonInteraction,
            ),
            false,
          );
          assertEquals(
            options.filter(
              { ...candidate, customId: "other-action" } as ButtonInteraction,
            ),
            false,
          );
          assertEquals(options.filter(candidate), true);
          assert(("waitMs" in value ? value.waitMs ?? 0 : 0) < options.time);
        },
      })),
    ),
  );
  const modalCalls = cleanup.use(
    strictFake<
      [ModalOptions],
      Extract<RecordMatchDiscordStep, { action: "input" }>
    >(
      "awaitModalSubmit",
      steps.filter((
        step,
      ): step is Extract<RecordMatchDiscordStep, { action: "input" }> =>
        step.action === "input"
      ).map((value) => ({
        value,
        check: (options: ModalOptions) => {
          const candidate = {
            user: interaction.user,
            customId: `record_match:${interaction.id}:button-${
              steps.indexOf(value) + 1
            }:${value.userId}`,
          } as ModalSubmitInteraction;
          assertEquals(
            options.filter(
              {
                ...candidate,
                user: { id: "outsider" },
              } as ModalSubmitInteraction,
            ),
            false,
          );
          assertEquals(
            options.filter(
              {
                ...candidate,
                customId: `record_match:other-session:${value.userId}`,
              } as ModalSubmitInteraction,
            ),
            false,
          );
          assertEquals(options.filter(candidate), true);
          if (!value.modalTimeout) assert((value.inputMs ?? 0) < options.time);
        },
      })),
    ),
  );
  const showModals = cleanup.use(
    strictFake<[ModalBuilder], undefined>(
      "showModal",
      steps.flatMap((step, index) =>
        step.action === "input"
          ? [{
            check: (modal: ModalBuilder) =>
              assertEquals(
                modal.toJSON().custom_id,
                `record_match:${interaction.id}:button-${
                  index + 1
                }:${step.userId}`,
              ),
            value: undefined,
          }]
          : []
      ),
    ),
  );

  function editReply(token: string, createdAt: number) {
    return (
      body: Parameters<ChatInputCommandInteraction["editReply"]>[0],
    ): Promise<Message> => {
      if (Date.now() - createdAt >= 15 * 60_000) {
        return Promise.reject(new Error("Interaction token expired"));
      }
      const payload = typeof body === "string"
        ? { content: body }
        : body as InteractionEditReplyOptions;
      edits.push({
        token,
        body: {
          content: payload.content,
          embeds: (payload.embeds ?? []).map((value) =>
            "toJSON" in value ? value.toJSON() : value
          ),
          components: (payload.components ?? []).map((value) =>
            "toJSON" in value ? value.toJSON() : value
          ),
        },
      });
      return Promise.resolve(message);
    };
  }
  const ackCount = steps.reduce(
    (count, step) =>
      count +
      (step.action === "input"
        ? step.modalTimeout ? 1 : 2
        : step.action === "confirm" || step.action === "cancel"
        ? 1
        : 0),
    0,
  );
  const acknowledged = cleanup.use(
    strictFake<[number], Promise<void>>(
      "acknowledge interaction",
      Array.from({ length: ackCount }, () => ({
        check: (createdAt: number) =>
          assert(
            Date.now() - createdAt < 3_000,
            "Fresh interaction must be acknowledged within 3 seconds",
          ),
        value: Promise.resolve(),
      })),
    ),
  );
  function acknowledgement(token: string, createdAt: number) {
    return () => {
      const result = acknowledged.invoke(createdAt);
      acknowledgements.push(token);
      return result;
    };
  }
  const message = {
    awaitMessageComponent(options: ButtonOptions) {
      const step = buttons.invoke(options);
      if (step.action === "failure") {
        return Promise.reject(new Error("Discord unavailable"));
      }
      if (step.action === "timeout") {
        tick(options.time);
        return Promise.reject(collectorTimeout());
      }
      tick("waitMs" in step ? step.waitMs ?? 0 : 0);
      const createdAt = Date.now();
      const token = `button-${buttons.calls.length}`;
      const button = {
        id: token,
        customId: step.action === "input"
          ? "input_record_match"
          : `${step.action}_record_match`,
        user: interaction.user,
        createdTimestamp: createdAt,
        deferUpdate: acknowledgement(token, createdAt),
        editReply: editReply(token, createdAt),
        showModal(modal: ModalBuilder) {
          showModals.invoke(modal);
          acknowledgement(token, createdAt)();
          modals.push(modal.toJSON());
          return Promise.resolve();
        },
        awaitModalSubmit(modalOptions: ModalOptions) {
          const input = modalCalls.invoke(modalOptions);
          tick(input.modalTimeout ? modalOptions.time : input.inputMs ?? 0);
          if (input.modalTimeout) return Promise.reject(collectorTimeout());
          const submittedAt = Date.now();
          const submissionToken = `modal-${modalCalls.calls.length}`;
          const draft = input.draft ??
            { kda: "10/2/8", cs: "200", gold: "12000" };
          const submission = {
            customId: `record_match:${interaction.id}:${token}:${input.userId}`,
            user: interaction.user,
            createdTimestamp: submittedAt,
            fields: {
              getTextInputValue: (field: keyof typeof draft) => draft[field],
            },
            deferUpdate: acknowledgement(submissionToken, submittedAt),
            editReply: editReply(submissionToken, submittedAt),
          } as unknown as ModalSubmitInteraction;
          return Promise.resolve(submission);
        },
      } as unknown as ButtonInteraction;
      return Promise.resolve(button);
    },
  } as unknown as Message;
  cleanup.use(
    stub(
      interaction,
      "editReply",
      editReply("command", interaction.createdTimestamp),
    ),
  );
  cleanup.use(
    stub(
      interaction,
      "followUp",
      () => Promise.reject(new Error("Unexpected old interaction follow-up")),
    ),
  );
  return {
    edits,
    modals,
    acknowledgements,
    buttons: buttons.calls,
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}
