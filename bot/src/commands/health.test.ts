import { assertEquals } from "jsr:@std/assert";
import { spy, stub } from "jsr:@std/testing/mock";
import {
  type CommandInteraction,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type MessagePayload,
} from "npm:discord.js";
import { execute } from "./health.ts";

Deno.test("Health Command", async (t) => {
  await t.step("execute", async (t) => {
    // Helper function to create spies and a mock interaction
    const setupMocks = () => {
      const deferReplySpy = spy(
        (_options?: InteractionDeferReplyOptions) => Promise.resolve(),
      );
      const editReplySpy = spy(
        (_options: string | MessagePayload | InteractionEditReplyOptions) =>
          Promise.resolve(),
      );
      const interaction = {
        isChatInputCommand: () => true,
        deferReply: deferReplySpy,
        editReply: editReplySpy,
      } as unknown as CommandInteraction;
      return { deferReplySpy, editReplySpy, interaction };
    };

    await t.step(
      "should reply with a success message when API is healthy",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response(
                JSON.stringify({ ok: true, message: "All systems operational." }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
        );
        const { deferReplySpy, editReplySpy, interaction } = setupMocks();

        try {
          await execute(interaction);
          assertEquals(deferReplySpy.calls.length, 1);
          assertEquals(editReplySpy.calls.length, 1);
          assertEquals(
            editReplySpy.calls[0].args[0],
            "All systems operational.",
          );
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step(
      "should use a default success message if API provides no message",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response(
                JSON.stringify({ ok: true, message: null }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
        );
        const { deferReplySpy, editReplySpy, interaction } = setupMocks();

        try {
          await execute(interaction);
          assertEquals(deferReplySpy.calls.length, 1);
          assertEquals(editReplySpy.calls.length, 1);
          assertEquals(
            editReplySpy.calls[0].args[0],
            "The bot is healthy!",
          );
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step(
      "should reply with an error message when API returns a non-200 status",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () =>
            Promise.resolve(
              new Response("Internal Server Error", { status: 500 }),
            ),
        );
        const { deferReplySpy, editReplySpy, interaction } = setupMocks();

        try {
          await execute(interaction);
          assertEquals(deferReplySpy.calls.length, 1);
          assertEquals(editReplySpy.calls.length, 1);
          assertEquals(
            editReplySpy.calls[0].args[0],
            "Failed to check the bot's health. API returned status 500",
          );
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step(
      "should reply with an error message on network failure",
      async () => {
        const fetchStub = stub(
          globalThis,
          "fetch",
          () => Promise.reject(new Error("Network disconnect")),
        );
        const { deferReplySpy, editReplySpy, interaction } = setupMocks();

        try {
          await execute(interaction);
          assertEquals(deferReplySpy.calls.length, 1);
          assertEquals(editReplySpy.calls.length, 1);
          assertEquals(
            editReplySpy.calls[0].args[0],
            "Failed to check the bot's health. Failed to communicate with API",
          );
        } finally {
          fetchStub.restore();
        }
      },
    );

    await t.step(
      "should not proceed if interaction is not a chat input command",
      async () => {
        const deferReplySpy = spy(
          (_options?: InteractionDeferReplyOptions) => Promise.resolve(),
        );
        const interaction = {
          isChatInputCommand: () => false,
          deferReply: deferReplySpy,
        } as unknown as CommandInteraction;

        await execute(interaction);
        assertEquals(deferReplySpy.calls.length, 0);
      },
    );
  });
});
