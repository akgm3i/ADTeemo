import { Hono } from "@hono/hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/actions.ts";
import { rso } from "../rso.ts";
import { messageHandler, messageKeys } from "../messages.ts";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const loginUrlQuerySchema = z.object({
  discordId: z.string().min(1),
});

export const authRoutes = new Hono()
  .get(
    "/rso/login-url",
    zValidator("query", loginUrlQuerySchema),
    async (c) => {
      const { discordId } = c.req.valid("query");
      const state = crypto.randomUUID();

      await dbActions.createAuthState(state, discordId);

      const authorizationUrl = rso.getAuthorizationUrl(state);

      return c.json({ url: authorizationUrl });
    },
  )
  .get(
    "/rso/callback",
    zValidator("query", callbackQuerySchema),
    async (c) => {
      const { code, state } = c.req.valid("query");

      // 1. Validate state and get discordId
      const authState = await dbActions.getAuthState(state);
      const stateMaxAge = 5 * 60 * 1000; // 5 minutes
      if (
        !authState ||
        new Date().getTime() - authState.createdAt.getTime() > stateMaxAge
      ) {
        if (authState) {
          // Clean up expired state to prevent it from being used again
          await dbActions.deleteAuthState(state);
        }
        return c.json({
          success: false,
          error: messageHandler.formatMessage(
            messageKeys.riotAccount.link.error.invalidState,
          ),
        }, 400);
      }
      const { discordId } = authState;

      try {
        // 2. Exchange code for tokens
        const { accessToken } = await rso.exchangeCodeForTokens(code);

        // 3. Get user info (Riot ID)
        const { sub: riotId } = await rso.getUserInfo(accessToken);

        // 4. Update user's Riot ID in DB
        await dbActions.updateUserRiotId(discordId, riotId);

        // 5. Clean up auth state
        await dbActions.deleteAuthState(state);

        // 6. Return success page
        return c.html(`
          <html>
            <head>
              <title>${
          messageHandler.formatMessage(
            messageKeys.riotAccount.link.success.title,
          )
        }</title>
              <style>
                body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; }
                .container { text-align: center; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>${
          messageHandler.formatMessage(
            messageKeys.riotAccount.link.success.title,
          )
        }</h1>
                <p>${
          messageHandler.formatMessage(
            messageKeys.riotAccount.link.success.body,
          )
        }</p>
              </div>
            </body>
          </html>
        `);
      } catch (error) {
        console.error("Error during RSO callback:", error);
        return c.json(
          {
            success: false,
            error: messageHandler.formatMessage(
              messageKeys.common.error.internalServerError,
            ),
          },
          500,
        );
      }
    },
  );
