// src/music/MusicManager.js
const { EmbedBuilder } = require("discord.js");
const { buildPlayerEmbed, buildPlayerComponents, formatMs } = require("../ui/playerUI");

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

class MusicManager {
  constructor({ client, shoukaku }) {
    this.client = client;
    this.shoukaku = shoukaku;
    this.sessions = new Map();
  }

  getSession(guildId) {
    return this.sessions.get(guildId) || null;
  }

  async ensureSession(interaction) {
    const guild = interaction.guild;
    if (!guild) throw new Error("Commande utilisable seulement sur un serveur.");

    const member = interaction.member;
    const voice = member?.voice?.channel;
    if (!voice) throw new Error("Rejoins un salon vocal d’abord.");

    const me = guild.members.me;
    if (me?.voice?.channelId && me.voice.channelId !== voice.id) {
      throw new Error("Je suis déjà utilisé dans un autre salon vocal sur ce serveur.");
    }

    let session = this.sessions.get(guild.id);
    if (session?.player) return session;

    const player = await this.shoukaku.joinVoiceChannel({
      guildId: guild.id,
      channelId: voice.id,
      shardId: guild.shardId ?? 0,
      deaf: true,
    });

    session = {
      guildId: guild.id,
      player,
      queue: [],
      current: null,
      loop: "off", // off | track | queue
      volume: 80, // 0-100
      controller: {
        channelId: interaction.channelId,
        messageId: null,
      },
      idleTimer: null,
    };

    this.sessions.set(guild.id, session);

    // Shoukaku global volume is 0-1000
    await player.setGlobalVolume(session.volume);

    this.bindPlayerEvents(session);
    return session;
  }

  bindPlayerEvents(session) {
    const player = session.player;

    player.on("start", async () => {
      await this.renderController(session.guildId).catch(() => {});
    });

    player.on("end", async (data) => {
      if (!this.sessions.has(session.guildId)) return;

      const reason = data?.reason;
      // replaced: quand on change de track volontairement
      if (reason === "replaced") return;

      await this.playNext(session.guildId, { ended: true }).catch(() => {});
    });

    player.on("exception", async () => {
      await this.playNext(session.guildId, { ended: true }).catch(() => {});
    });

    player.on("stuck", async () => {
      await this.playNext(session.guildId, { ended: true }).catch(() => {});
    });
  }

  /**
   * Resolve tracks compatible Lavalink v4 (loadType + data) and v3 (tracks).
   */
  async resolveTrack(session, query, source) {
    const q = isUrl(query) ? query : `${source || "ytsearch"}:${query}`;

    const result = await session.player.node.rest.resolve(q);
    const loadType = result?.loadType || "EMPTY";

    let tracks = [];
    let playlistInfo = null;

    // Lavalink v3 => { tracks: [], playlistInfo: {} }
    if (Array.isArray(result?.tracks)) {
      tracks = result.tracks;
      playlistInfo = result.playlistInfo ?? null;
      return { type: loadType, tracks, playlistInfo };
    }

    // Lavalink v4 => { loadType, data }
    const lt = String(loadType).toLowerCase();
    const data = result?.data;

    if (lt === "track" && data) {
      tracks = [data];
    } else if (lt === "playlist" && data) {
      tracks = Array.isArray(data.tracks) ? data.tracks : [];
      playlistInfo = data.info ?? null;
    } else if (lt === "search" && Array.isArray(data)) {
      tracks = data;
    } else {
      tracks = [];
    }

    return { type: loadType, tracks, playlistInfo };
  }

  async play(interaction, query, source) {
    const session = await this.ensureSession(interaction);

    const resolved = await this.resolveTrack(session, query, source);
    if (!resolved.tracks.length) {
      throw new Error("Aucun résultat. Essaie une autre recherche ou une URL directe.");
    }

    const requesterId = interaction.user.id;

    // Tracks Lavalink v4: { encoded, info }
    const toAdd = resolved.tracks
      .map((t) => ({
        encoded: t.encoded,
        info: t.info,
        requesterId,
      }))
      .filter((t) => t.encoded);

    if (!toAdd.length) {
      throw new Error("Résultat invalide (aucun track encodé). Essaie une autre recherche.");
    }

    session.queue.push(...toAdd);

    // Démarrer si rien ne joue
    if (!session.current && !session.player.track) {
      await this.playNext(session.guildId, { ended: false });
    } else {
      await this.renderController(session.guildId);
    }

    const addedMsg =
      toAdd.length === 1
        ? `✅ Ajouté: **${toAdd[0].info?.title || "Titre"}**`
        : `✅ Ajouté **${toAdd.length}** titres à la file.`;

    return addedMsg;
  }

  async playNext(guildId, { ended }) {
    const session = this.sessions.get(guildId);
    if (!session) return;

    // Boucle : si un titre vient de finir
    const finished = session.current;
    if (ended && finished) {
      if (session.loop === "track") {
        session.queue.unshift(finished);
      } else if (session.loop === "queue") {
        session.queue.push(finished);
      }
    }

    const next = session.queue.shift() || null;
    session.current = next;

    if (!next) {
      // plus rien à jouer : idle + leave après 2 minutes
      await this.renderController(guildId);

      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        this.destroy(guildId).catch(() => {});
      }, 2 * 60 * 1000);

      return;
    }

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    await session.player.playTrack({ track: { encoded: next.encoded } });
    await this.renderController(guildId);
  }

  async pause(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Rien à mettre en pause.");
    await session.player.setPaused(true);
    await this.renderController(guildId);
  }

  async resume(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Rien à reprendre.");
    await session.player.setPaused(false);
    await this.renderController(guildId);
  }

  async skip(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Rien à skip.");
    await session.player.stopTrack();
    // l'event end() enchaîne sur playNext()
  }

  async stop(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return;

    session.queue = [];
    session.current = null;

    try {
      await session.player.stopTrack();
    } catch {}

    await this.destroy(guildId);
  }

  async setVolume(guildId, volume) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Aucun player actif.");

    session.volume = Math.max(0, Math.min(100, volume));
    await session.player.setGlobalVolume(session.volume * 10);
    await this.renderController(guildId);
  }

  cycleLoop(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return "off";
    session.loop = session.loop === "off" ? "track" : session.loop === "track" ? "queue" : "off";
    return session.loop;
  }

  buildQueueEmbed(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) {
      return new EmbedBuilder().setColor(0x9b59b6).setDescription("Aucune file active.");
    }

    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("📜 Queue");
    const lines = [];

    if (session.current?.info) {
      lines.push(
        `**Now:** ${session.current.info.title || "Titre"} \`(${formatMs(session.current.info.length)})\``
      );
    }

    if (!session.queue.length) {
      lines.push("\n*Queue vide.*");
    } else {
      session.queue.slice(0, 15).forEach((t, i) => {
        lines.push(`${i + 1}. ${t.info?.title || "Titre"} \`(${formatMs(t.info?.length)})\``);
      });
      if (session.queue.length > 15) lines.push(`\n… +${session.queue.length - 15} autre(s)`);
    }

    embed.setDescription(lines.join("\n"));
    return embed;
  }

  async renderController(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return;

    const channel = await this.client.channels.fetch(session.controller.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    const embed = buildPlayerEmbed(session);
    const components = buildPlayerComponents(session);

    // créer ou éditer le panel
    if (!session.controller.messageId) {
      const msg = await channel.send({ embeds: [embed], components });
      session.controller.messageId = msg.id;
      return;
    }

    const msg = await channel.messages.fetch(session.controller.messageId).catch(() => null);
    if (!msg) {
      session.controller.messageId = null;
      const newMsg = await channel.send({ embeds: [embed], components });
      session.controller.messageId = newMsg.id;
      return;
    }

    await msg.edit({ embeds: [embed], components }).catch(() => {});
  }

  async destroy(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);

    try {
      await this.shoukaku.leaveVoiceChannel(guildId);
    } catch {}

    this.sessions.delete(guildId);
  }
}

module.exports = { MusicManager };
