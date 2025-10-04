import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import { Guild, Message, User } from "discord.js";
import { execute, splitTeamHandlers as handlers } from "./split-teams.ts";
import { type Event, type Lane } from "@adteemo/api/schema";

import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";

describe("split-teams command", () => {
  describe("execute", () => {
    test("正常なフローで、各ヘルパー関数を正しい引数で呼び出す", async () => {
      // Arrange
      const guild = new MockGuildBuilder().build();
      const interaction = new MockInteractionBuilder().withGuild(guild).build();
      (interaction as { inGuild: () => true }).inGuild = () => true;

      const event: Event = {
        id: 1,
        name: "test-event",
        guildId: "g-id",
        creatorId: "u-id",
        discordScheduledEventId: "de-id",
        recruitmentMessageId: "msg-id",
        createdAt: new Date("2025-09-28T10:00:00.000Z"),
        scheduledStartAt: new Date("2025-09-28T10:00:00.000Z"),
      };
      const message = {} as Message;
      const participants: {
        participantsByRole: Map<Lane, User[]>;
        allParticipants: Set<User>;
      } = {
        participantsByRole: new Map(),
        allParticipants: new Set(),
      };
      const teams = { teamA: new Map(), teamB: new Map() };

      using fetchEventStub = stub(handlers, "fetchEvent", async (creatorId) => {
        return event;
      });
      using fetchMsgStub = stub(
        handlers,
        "fetchRecruitmentMessage",
        async (guildArg, channelId, messageId) => {
          return message;
        },
      );
      using fetchParticipantsStub = stub(
        handlers,
        "fetchParticipants",
        async (msg) => {
          return participants;
        },
      );
      using validateStub = stub(
        handlers,
        "validateParticipants",
        (participantsByRole, allParticipants) => {
        },
      );
      using splitStub = stub(
        handlers,
        "splitTeams",
        (participantsByRole) => {
          return teams;
        },
      );
      using moveStub = stub(
        handlers,
        "moveMembersToVoiceChannels",
        async (guildArg, teamA, teamB) => {
        },
      );
      using announceStub = stub(
        handlers,
        "announceTeams",
        async (interactionArg, teamA, teamB) => {
        },
      );
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      // Act
      await execute(interaction);

      // Assert
      assertSpyCall(deferSpy, 0);
      assertSpyCall(fetchEventStub, 0, { args: [interaction.user.id] });
      assertSpyCall(fetchMsgStub, 0, {
        args: [
          interaction.guild!,
          interaction.channelId,
          event.recruitmentMessageId,
        ],
      });
      assertSpyCall(fetchParticipantsStub, 0, { args: [message] });
      assertSpyCall(validateStub, 0, {
        args: [participants.participantsByRole, participants.allParticipants],
      });
      assertSpyCall(splitStub, 0, { args: [participants.participantsByRole] });
      assertSpyCall(moveStub, 0, {
        args: [interaction.guild!, teams.teamA, teams.teamB],
      });
      assertSpyCall(announceStub, 0, {
        args: [interaction, teams.teamA, teams.teamB],
      });
      assertSpyCalls(editSpy, 0);
    });
  });
});
