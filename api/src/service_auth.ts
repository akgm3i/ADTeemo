import { createMiddleware } from "@hono/hono/factory";
import {
  BOT_SERVICE_AUTH_SCHEME,
  BOT_SERVICE_TOKEN_MIN_LENGTH,
} from "./contract/service_auth.ts";
import type { AppDependencies, EnvReader } from "./dependencies.ts";

const UNAUTHORIZED_RESPONSE = {
  code: "UNAUTHORIZED",
  error: "Unauthorized",
} as const;
const encoder = new TextEncoder();

function validateCredential(
  credential: string | undefined,
  envName: string,
  required: boolean,
): string | undefined {
  if (!credential) {
    if (required) {
      throw new Error(
        `${envName} must be at least ${BOT_SERVICE_TOKEN_MIN_LENGTH} characters`,
      );
    }
    return undefined;
  }

  if (credential.length < BOT_SERVICE_TOKEN_MIN_LENGTH) {
    throw new Error(
      `${envName} must be at least ${BOT_SERVICE_TOKEN_MIN_LENGTH} characters`,
    );
  }

  return credential;
}

export function readBotServiceCredentials(env: EnvReader): readonly string[] {
  const current = validateCredential(
    env.get("BOT_SERVICE_TOKEN"),
    "BOT_SERVICE_TOKEN",
    true,
  );
  const previous = validateCredential(
    env.get("BOT_SERVICE_TOKEN_PREVIOUS"),
    "BOT_SERVICE_TOKEN_PREVIOUS",
    false,
  );

  if (!current) {
    throw new Error("BOT_SERVICE_TOKEN is required");
  }

  return previous && previous !== current ? [current, previous] : [current];
}

async function digestCredential(credential: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(credential)),
  );
}

function equalDigest(left: Uint8Array, right: Uint8Array): boolean {
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function bearerCredential(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = new RegExp(`^${BOT_SERVICE_AUTH_SCHEME} ([^\\s]+)$`, "i")
    .exec(header);
  return match?.[1];
}

export function createBotServiceAuthMiddleware(
  deps: Pick<AppDependencies, "env" | "logger">,
) {
  const credentials = readBotServiceCredentials(deps.env);
  const configuredDigests = Promise.all(credentials.map(digestCredential));

  return createMiddleware(async (c, next) => {
    const authorization = c.req.header("Authorization");
    const candidate = bearerCredential(authorization);
    let authorized = false;

    if (candidate) {
      const candidateDigest = await digestCredential(candidate);
      for (const configuredDigest of await configuredDigests) {
        authorized = equalDigest(candidateDigest, configuredDigest) ||
          authorized;
      }
    }

    if (!authorized) {
      deps.logger.warn("service_auth.rejected", {
        http: {
          method: c.req.method,
          path: c.req.path,
        },
        reason: authorization
          ? (candidate ? "invalid" : "malformed")
          : "missing",
      });
      c.header("WWW-Authenticate", 'Bearer realm="adteemo-api"');
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }

    await next();
  });
}
