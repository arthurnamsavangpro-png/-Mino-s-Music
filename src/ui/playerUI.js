// src/ui/playerUI.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const ACCENT = 0x1db954; // vibe Spotify (Dark Luxe)

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

function progressBar(position, duration, size = 22) {
  if (!Number.isFinite(duration) || duration <= 0) return "🔴 LIVE";
  const pct = clamp(position / duration, 0, 1);
  const idx = Math.floor(pct * size);
  let bar = "";
  for (let i = 0; i < size; i++) bar += i === idx ? "🔘" : "▬";
  return `${formatMs(position)} ┃ ${bar} ┃ ${formatMs(duration)}`;
}

function badge(text) {
  return `\`${text}\``;
}

function niceLoop(loop) {
  if (loop === "track") return "TRACK";
  if (loop === "queue") return "QUEUE";
  return "OFF";
}

function niceFilter(preset) {
  if (!preset || preset === "none") return "NONE";
  return preset.toUpperCase();
}

function pickArtwork(info) {
  return info?.artworkUrl || info?.thumbnail || info?.image || null;
}

function buildPlayerEmbed(session) {
  const t = session.current;
  const loopLabel = niceLoop(session.loop);
  const filterLabel = niceFilter(session.filters?.preset);

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setFooter({ text: "Kira's Music • Dark Luxe Panel" })
    .setTimestamp();

  // Aucune track
  if (!t) {
    embed
      .setTitle("🎧 Kira's Music — Panel")
      .setDescription(
        [
          "Aucun son en cours.",
          "Utilise **/play** ou le bouton **➕ Add** (quand je suis en vocal).",
          "",
          `${badge(`VOL ${session.volume}`)} ${badge(`LOOP ${loopLabel}`)} ${badge(`FX ${filterLabel}`)} ${badge(
            `QUEUE ${session.queue.length}`
          )}`,
        ].join("\n")
      );

    return embed;
  }

  const info = t.info || {};
  const title = info.title || "Titre inconnu";
  const author = info.author || "Artiste inconnu";
  const uri = info.uri || null;
  const artwork = pickArtwork(info);

  const isLive = !Number.isFinite(info.length) || info.length <= 0;

  const statsLine = [
    badge(`VOL ${session.volume}`),
    badge(`LOOP ${loopLabel}`),
    badge(`FX ${filterLabel}`),
    badge(`QUEUE ${session.queue.length}`),
    isLive ? badge("LIVE") : badge(formatMs(info.length)),
  ].join(" ");

  embed.setTitle("🎧 Now Playing");
  embed.setDescription(
    [
      uri ? `[**${title}**](${uri})` : `**${title}**`,
      `*${author}*`,
      "",
      statsLine,
      "",
      `**Progress**\n${progressBar(session.player?.position ?? 0, info.length ?? 0)}`,
      "",
      `👤 Demandé par <@${t.requesterId}>`,
    ].join("\n")
  );

  // Cover en grand (style Spotify)
  if (artwork) embed.setImage(artwork);

  // Next preview
  const next = session.queue[0]?.info?.title;
  embed.addFields({
    name: "Up Next",
    value: next ? `➡️ ${next}` : "—",
    inline: false,
  });

  return embed;
}

function buildPlayerComponents(session) {
  const hasTrack = Boolean(session.current);
  const paused = Boolean(session.player?.paused);
  const canSeek = hasTrack && Number.isFinite(session.current?.info?.length) && session.current.info.length > 0;

  // Row 1: playback
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:prev")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏮️")
      .setDisabled(!hasTrack),

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
      .setEmoji("🔁")
  );

  // Row 2: tools
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔀")
      .setDisabled(session.queue.length < 2),

    new ButtonBuilder().setCustomId("music:add").setStyle(ButtonStyle.Secondary).setEmoji("➕"),

    new ButtonBuilder().setCustomId("music:filters").setStyle(ButtonStyle.Secondary).setEmoji("🎚️"),

    new ButtonBuilder().setCustomId("music:queue").setStyle(ButtonStyle.Secondary).setEmoji("📜"),

    new ButtonBuilder()
      .setCustomId("music:clear")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🧹")
      .setDisabled(session.queue.length === 0)
  );

  // Row 3: seek + volume + refresh
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music:seekback")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏪")
      .setDisabled(!canSeek),

    new ButtonBuilder()
      .setCustomId("music:seekfwd")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏩")
      .setDisabled(!canSeek),

    new ButtonBuilder().setCustomId("music:voldown").setStyle(ButtonStyle.Secondary).setEmoji("🔉"),

    new ButtonBuilder().setCustomId("music:volup").setStyle(ButtonStyle.Secondary).setEmoji("🔊"),

    new ButtonBuilder().setCustomId("music:refresh").setStyle(ButtonStyle.Secondary).setEmoji("🔄")
  );

  return [row1, row2, row3];
}

function buildFiltersSelectMenu(currentPreset = "none") {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("music:filtersSelect")
    .setPlaceholder("Choisis un filtre (Dark Luxe presets)…")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("BassBoost")
        .setValue("bassboost")
        .setDescription("Plus de basses, propre & stable")
        .setDefault(currentPreset === "bassboost"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Nightcore")
        .setValue("nightcore")
        .setDescription("Plus rapide + pitch léger")
        .setDefault(currentPreset === "nightcore"),
      new StringSelectMenuOptionBuilder()
        .setLabel("8D")
        .setValue("8d")
        .setDescription("Rotation stéréo (effet spatial)")
        .setDefault(currentPreset === "8d"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Vaporwave")
        .setValue("vaporwave")
        .setDescription("Lent + plus “wide”")
        .setDefault(currentPreset === "vaporwave"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Reset (None)")
        .setValue("none")
        .setDescription("Retire tous les filtres")
        .setDefault(currentPreset === "none")
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildQueueEmbed(session, page = 1, pageSize = 10) {
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle("📜 Queue");

  if (!session) {
    embed.setDescription("Aucune session active.");
    return { embed, page: 1, totalPages: 1 };
  }

  const all = session.queue;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = clamp(page, 1, totalPages);

  const start = (p - 1) * pageSize;
  const slice = all.slice(start, start + pageSize);

  const lines = [];

  if (session.current?.info) {
    lines.push(
      `**Now:** ${session.current.info.title || "Titre"} \`(${formatMs(session.current.info.length)})\``
    );
    lines.push("");
  }

  if (!slice.length) {
    lines.push("*Queue vide.*");
  } else {
    slice.forEach((t, i) => {
      const idx = start + i + 1;
      lines.push(`${idx}. ${t.info?.title || "Titre"} \`(${formatMs(t.info?.length)})\``);
    });
  }

  embed.setDescription(lines.join("\n"));
  embed.setFooter({ text: `Page ${p}/${totalPages} • ${all.length} dans la queue` });

  return { embed, page: p, totalPages };
}

function buildQueuePagerComponents(page, totalPages) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:queuePage:${page - 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⬅️")
      .setDisabled(page <= 1),

    new ButtonBuilder()
      .setCustomId(`music:queuePage:${page + 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("➡️")
      .setDisabled(page >= totalPages),

    new ButtonBuilder().setCustomId("music:queueClose").setStyle(ButtonStyle.Danger).setEmoji("✖️")
  );

  return [row];
}

module.exports = {
  buildPlayerEmbed,
  buildPlayerComponents,
  buildFiltersSelectMenu,
  buildQueueEmbed,
  buildQueuePagerComponents,
  formatMs,
};
