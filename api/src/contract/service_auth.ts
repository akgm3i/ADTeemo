export const BOT_SERVICE_AUTH_SCHEME = "Bearer";
export const BOT_SERVICE_TOKEN_MIN_LENGTH = 32;

export function botServiceAuthorization(credential: string): string {
  return `${BOT_SERVICE_AUTH_SCHEME} ${credential}`;
}
