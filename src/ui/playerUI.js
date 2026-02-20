const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "LIVE";
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (x) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function progressBar(position, duration, size = 18) {
  if (!Number.isFinite(duration) || duration <= 0) return "🔴 LIVE";
  const pct = clamp(position / duration, 0, 1);
  const idx = Math.floor(pct * size);
  let bar = "";
  for (let i = 0; i < size; i++) bar += i === idx ? "🔘" : "▬";
  return `${formatMs(position)} ┃ ${bar} ┃ ${formatMs(duration)}`;
}

function buildPlayerEmbed(session) {
  const t = session.current;
  const loopLabel = session.loop === "off" ? "Off" : session.loop === "track" ? "Track" : "Queue";

  const embed = new EmbedBuilder()
    .setTitle("🎶 Mino Music — Panel")
    .setColor(0x9b59b6)
    .setFooter({ text: "Contrôles: boutons ci-dessous • /help bientôt si tu veux" });

  if (!t) {
    embed.setDescription("Aucun son en cours.\nUtilise **/play** pour lancer une musique.");
    embed.addFields(
      { name: "Volume", value: `${session.volume}%`, inline: true },
      { name: "Loop", value: loopLabel, inline: true },
      { name: "Queue", value: `${session.queue.length} titre(s)`, inline: true }
    );
    return embed;
  }

  const info = t.info || {};
  const title = info.title || "Titre inconnu";
  const author = info.author || "Artiste inconnu";
  const uri = info.uri || null;
  const artwork = info.artworkUrl || info.thumbnail || null;

  embed.setDescription(`${uri ? `[**${title}**](${uri})` : `**${title}**`}\n*${author}*`);
  if (artwork) embed.setThumbnail(artwork);

  embed.addFields(
    { name: "Progress", value: progressBar(session.player?.position ?? 0, info.length ?? 0), inline: false },
    { name: "Demandé par", value: `<@${t.requesterId}>`, inline: true },
    { name: "Volume", value: `${session.volume}%`, inline: true },
    { name: "Loop", value: loopLabel, inline: true },
    { name: "Dans la queue", value: `${session.queue.length}`, inline: true }
  );

  const next = session.queue[0]?.info?.title;
  embed.addFields({ name: "Next", value: next ? `➡️ ${next}` : "—", inline: false });

  return embed;
}

function buildPlayerComponents(session) {
  const hasTrack = Boolean(session.current);
  const paused = Boolean(session.player?.paused);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:toggle")
      .setStyle(ButtonStyle.Primary)
      .setEmoji(paused ? "▶️" : "⏸️")
      .setDisabled(!hasTrack),

    new ButtonBuilder()
      .setCustomId("music:skip")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setDisabled(!hasTrack),

    new ButtonBuilder()
      .setCustomId("music:stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️")
      .setDisabled(!hasTrack && session.queue.length === 0),

    new ButtonBuilder()
      .setCustomId("music:loop")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔁"),

    new ButtonBuilder()
      .setCustomId("music:queue")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📜")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:voldown")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔉"),
    new ButtonBuilder()
      .setCustomId("music:volup")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔊"),
    new ButtonBuilder()
      .setCustomId("music:refresh")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄")
  );

  return [row1, row2];
}

module.exports = {
  buildPlayerEmbed,
  buildPlayerComponents,
  formatMs,
};
