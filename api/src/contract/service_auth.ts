export const BOT_SERVICE_AUTH_SCHEME = "Bearer";
export const BOT_SERVICE_TOKEN_MIN_LENGTH = 32;
export const BOT_SERVICE_TOKEN_MAX_LENGTH = 256;

export function isBotServiceCredentialLengthValid(
  credential: string,
): boolean {
  return credential.length >= BOT_SERVICE_TOKEN_MIN_LENGTH &&
    credential.length <= BOT_SERVICE_TOKEN_MAX_LENGTH;
}

export function botServiceAuthorization(credential: string): string {
  return `${BOT_SERVICE_AUTH_SCHEME} ${credential}`;
}
