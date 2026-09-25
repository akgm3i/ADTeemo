import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  callbackQuerySchema,
  loginUrlQuerySchema,
} from "../contract/schemas.ts";
import { messageHandler, messageKeys } from "../messages.ts";
import type { AppDependencies } from "../dependencies.ts";
import { DomainConflictError } from "../errors.ts";
import { RsoProviderError } from "../rso.ts";
import { apiErrorResponse, apiValidationHook } from "../api_errors.ts";

type AuthDbActions = Pick<
  AppDependencies["dbActions"],
  "createAuthState" | "consumeAuthState" | "upsertRiotAccount"
>;

type AuthRouteDependencies = {
  dbActions: AuthDbActions;
  rso: AppDependencies["rso"];
};

export function authBotServiceRoutes(deps: AuthRouteDependencies) {
  const { dbActions, rso } = deps;
  return new Hono()
    .get(
      "/rso/login-url",
      zValidator("query", loginUrlQuerySchema, apiValidationHook),
      async (c) => {
        const binding = c.req.valid("query");
        const state = crypto.randomUUID();

        const authorizationUrl = rso.getAuthorizationUrl(state);
        await dbActions.createAuthState(state, binding);

        return c.json({ url: authorizationUrl }, 200);
      },
    );
}

export function authCallbackRoutes(deps: AuthRouteDependencies) {
  const { dbActions, rso } = deps;
  return new Hono().get(
    "/rso/callback",
    zValidator("query", callbackQuerySchema, apiValidationHook),
    async (c) => {
      const { code, state } = c.req.valid("query");

      try {
        const authState = await dbActions.consumeAuthState(state);
        const age = authState ? Date.now() - authState.createdAt.getTime() : -1;
        if (
          !authState || !authState.guildId || age < 0 || age >= 5 * 60 * 1000
        ) {
          return apiErrorResponse(c, "INVALID_REQUEST", {
            message: messageHandler.formatMessage(
              messageKeys.riotAccount.link.error.invalidState,
            ),
          });
        }
        const { accessToken } = await rso.exchangeCodeForTokens(code);
        // OAuth subject (userinfo.sub) is not an Account-v1 PUUID or display Riot ID.
        const account = await rso.getAccount(accessToken, authState.region);
        await dbActions.upsertRiotAccount({
          discordId: authState.discordId,
          puuid: account.puuid,
          gameName: account.gameName,
          tagLine: account.tagLine,
          platform: authState.platform,
          region: authState.region,
        });

        // Display success only after canonical persistence succeeds.
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
        if (error instanceof DomainConflictError) {
          return apiErrorResponse(c, "CONFLICT");
        }
        if (error instanceof RsoProviderError) {
          return apiErrorResponse(c, "RIOT_API_UNAVAILABLE", {
            cause: error,
            errorCategory: "remote_api",
          });
        }
        return apiErrorResponse(c, "INTERNAL_ERROR", { cause: error });
      }
    },
  );
}
