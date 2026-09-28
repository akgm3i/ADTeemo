import { EmbedBuilder } from "discord.js";

/** Discord history retains embeds, but not the nonce returned by send. */
export function withMessageMarker(
  embed: EmbedBuilder,
  marker: string,
  channelUrl?: string,
) {
  const copy = new EmbedBuilder(embed.toJSON());
  const footer = copy.data.footer;
  // Compact notifications keep their visible text unchanged. The title links
  // to its channel; the URL fragment retains the receipt in Discord history.
  if (!footer && !copy.data.url && channelUrl) {
    return copy.setURL(`${channelUrl}#${encodeURIComponent(marker)}`);
  }
  return copy.setFooter({
    ...footer,
    text: footer?.text ? `${footer.text}\n${marker}` : marker,
  });
}

export function hasMessageMarker(
  message: {
    author?: { id: string };
    client?: { user: { id: string } | null };
    embeds?: { footer?: { text: string } | null; url?: string | null }[];
  },
  marker: string,
) {
  return !!message.client?.user &&
    message.author?.id === message.client.user.id &&
    message.embeds?.some((embed) => {
        const text = embed.footer?.text;
        return text === marker || text?.endsWith(`\n${marker}`) ||
          (embed.url?.startsWith("https://discord.com/channels/") &&
            embed.url.endsWith(`#${encodeURIComponent(marker)}`));
      }) === true;
}
