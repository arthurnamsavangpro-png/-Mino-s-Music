// src/music/MusicManager.js
const { EmbedBuilder } = require("discord.js");
const { buildPlayerEmbed, buildPlayerComponents, formatMs } = require("../ui/playerUI");

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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
      history: [],
      loop: "off", // off | track | queue
      volume: 100, // Global volume 0-1000 (100 = normal)
      filters: {
        preset: "none",
      },
      controller: {
        channelId: interaction.channelId,
        messageId: null,
      },
      idleTimer: null,
      refreshTimer: null,
    };

    this.sessions.set(guild.id, session);

    await player.setGlobalVolume(session.volume);
    await player.clearFilters().catch(() => {}); // safe

    this.bindPlayerEvents(session);
    return session;
  }

  bindPlayerEvents(session) {
    const player = session.player;

    // auto refresh du panel (15s) pendant lecture
    const startAutoRefresh = () => {
      if (session.refreshTimer) clearInterval(session.refreshTimer);
      session.refreshTimer = setInterval(() => {
        this.renderController(session.guildId).catch(() => {});
      }, 15000);
      session.refreshTimer.unref?.();
    };

    const stopAutoRefresh = () => {
      if (session.refreshTimer) clearInterval(session.refreshTimer);
      session.refreshTimer = null;
    };

    player.on("start", async () => {
      startAutoRefresh();
      await this.renderController(session.guildId).catch(() => {});
    });

    player.on("end", async (data) => {
      if (!this.sessions.has(session.guildId)) return;

      const reason = data?.reason;
      if (reason === "replaced") return;

      stopAutoRefresh();
      await this.playNext(session.guildId, { ended: true }).catch(() => {});
    });

    player.on("exception", async () => {
      stopAutoRefresh();
      await this.playNext(session.guildId, { ended: true }).catch(() => {});
    });

    player.on("stuck", async () => {
      stopAutoRefresh();
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

    // place le panel dans le channel où la commande est faite
    session.controller.channelId = interaction.channelId;

    const resolved = await this.resolveTrack(session, query, source);
    if (!resolved.tracks.length) {
      throw new Error("Aucun résultat. Essaie une autre recherche ou une URL directe.");
    }

    const requesterId = interaction.user.id;

    const toAdd = resolved.tracks
      .map((t) => ({
        encoded: t.encoded,
        info: t.info,
        requesterId,
      }))
      .filter((t) => t.encoded);

    if (!toAdd.length) {
      throw new Error("Résultat invalide (aucun track encodé).");
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

    const finished = session.current;

    if (ended && finished) {
      // garde historique pour "previous"
      session.history.push(finished);

      // boucle
      if (session.loop === "track") {
        session.queue.unshift(finished);
      } else if (session.loop === "queue") {
        session.queue.push(finished);
      }
    }

    const next = session.queue.shift() || null;
    session.current = next;

    if (!next) {
      await this.renderController(guildId);

      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        this.destroy(guildId).catch(() => {});
      }, 2 * 60 * 1000);
      session.idleTimer.unref?.();

      return;
    }

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    await session.player.playTrack({ track: { encoded: next.encoded } });
    await this.renderController(guildId);
  }

  async previous(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player || !session.current) throw new Error("Aucun titre en cours.");

    const prev = session.history.pop();
    if (!prev) throw new Error("Aucun titre précédent.");

    // remet le current en tête de queue pour pouvoir revenir
    session.queue.unshift(session.current);
    session.current = prev;

    await session.player.playTrack({ track: { encoded: prev.encoded } });
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

  async toggle(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Aucun player actif.");
    await session.player.setPaused(!session.player.paused);
    await this.renderController(guildId);
  }

  async skip(guildId) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Rien à skip.");
    await session.player.stopTrack();
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

    // global volume Shoukaku: 0-1000 (100 = normal). On reste safe.
    session.volume = Math.max(0, Math.min(200, volume));
    await session.player.setGlobalVolume(session.volume);
    await this.renderController(guildId);
  }

  async volumeUp(guildId, step = 10) {
    const session = this.sessions.get(guildId);
    if (!session) return;
    await this.setVolume(guildId, Math.min(200, session.volume + step));
  }

  async volumeDown(guildId, step = 10) {
    const session = this.sessions.get(guildId);
    if (!session) return;
    await this.setVolume(guildId, Math.max(0, session.volume - step));
  }

  cycleLoop(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return "off";
    session.loop = session.loop === "off" ? "track" : session.loop === "track" ? "queue" : "off";
    return session.loop;
  }

  shuffle(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return;
    shuffleArray(session.queue);
  }

  clearQueue(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return;
    session.queue = [];
  }

  async seekRelative(guildId, deltaMs) {
    const session = this.sessions.get(guildId);
    if (!session?.player || !session.current?.info?.length) throw new Error("Seek indisponible (LIVE).");

    const duration = session.current.info.length;
    const nextPos = Math.max(0, Math.min(duration - 1000, (session.player.position ?? 0) + deltaMs));
    await session.player.seekTo(nextPos);
    await this.renderController(guildId);
  }

  async setFilterPreset(guildId, preset) {
    const session = this.sessions.get(guildId);
    if (!session?.player) throw new Error("Aucun player actif.");

    session.filters.preset = preset || "none";

    // presets “propres” (évite distorsion)
    if (!preset || preset === "none") {
      await session.player.clearFilters();
      await this.renderController(guildId);
      return;
    }

    if (preset === "bassboost") {
      // boost bas fréquences léger
      const eq = [
        { band: 0, gain: 0.15 },
        { band: 1, gain: 0.12 },
        { band: 2, gain: 0.08 },
      ];
      await session.player.setFilters({ equalizer: eq });
    }

    if (preset === "nightcore") {
      await session.player.setFilters({
        timescale: { speed: 1.12, pitch: 1.1, rate: 1.0 },
      });
    }

    if (preset === "8d") {
      await session.player.setFilters({
        rotation: { rotationHz: 0.2 },
      });
    }

    if (preset === "vaporwave") {
      const eq = [
        { band: 0, gain: 0.08 },
        { band: 1, gain: 0.06 },
        { band: 2, gain: 0.03 },
        { band: 10, gain: 0.06 },
        { band: 11, gain: 0.08 },
        { band: 12, gain: 0.09 },
      ];
      await session.player.setFilters({
        timescale: { speed: 0.88, pitch: 0.9, rate: 1.0 },
        equalizer: eq,
      });
    }

    await this.renderController(guildId);
  }

  buildQueueEmbed(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) {
      return new EmbedBuilder().setColor(0x1db954).setDescription("Aucune file active.");
    }

    const embed = new EmbedBuilder().setColor(0x1db954).setTitle("📜 Queue");
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
    if (session.refreshTimer) clearInterval(session.refreshTimer);

    try {
      await this.shoukaku.leaveVoiceChannel(guildId);
    } catch {}

    this.sessions.delete(guildId);
  }
}

module.exports = { MusicManager };
