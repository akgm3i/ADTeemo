import { EmbedBuilder } from "discord.js";

/** Discord history retains embeds, but not the nonce returned by send. */
export function withMessageMarker(embed: EmbedBuilder, marker: string) {
  const copy = new EmbedBuilder(embed.toJSON());
  const footer = copy.data.footer;
  return copy.setFooter({
    ...footer,
    text: footer?.text ? `${footer.text}\n${marker}` : marker,
  });
}

export function hasMessageMarker(
  message: {
    author?: { id: string };
    client?: { user: { id: string } | null };
    embeds?: { footer?: { text: string } | null }[];
  },
  marker: string,
) {
  return !!message.client?.user &&
    message.author?.id === message.client.user.id &&
    message.embeds?.some((embed) => {
        const text = embed.footer?.text;
        return text === marker || text?.endsWith(`\n${marker}`);
      }) === true;
}
