require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, PermissionFlagsBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");
const { commands } = require("./src/commands");
const { MusicManager } = require("./src/music/MusicManager");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  LAVALINK_HOST,
  LAVALINK_PORT,
  LAVALINK_PASSWORD,
  LAVALINK_SECURE,
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN et CLIENT_ID sont requis.");
  process.exit(1);
}
if (!LAVALINK_HOST || !LAVALINK_PASSWORD) {
  console.error("❌ LAVALINK_HOST et LAVALINK_PASSWORD sont requis.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`✅ Slash commands enregistrées (GUILD ${GUILD_ID}).`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands enregistrées (GLOBAL).");
  }
}

const nodes = [
  {
    name: "railway",
    url: `${LAVALINK_HOST}:${LAVALINK_PORT || 2333}`,
    auth: LAVALINK_PASSWORD,
    secure: String(LAVALINK_SECURE).toLowerCase() === "true",
  },
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
  resume: true,
  resumeTimeout: 60,
  reconnectTries: 5,
  reconnectInterval: 10,
  restTimeout: 60,
});

shoukaku.on("ready", (name) => console.log(`🔊 Lavalink node ready: ${name}`));
shoukaku.on("error", (name, error) => console.error(`❌ Lavalink error (${name})`, error));
shoukaku.on("close", (name, code, reason) => console.warn(`⚠️ Lavalink close (${name})`, code, reason));

client.music = new MusicManager({ client, shoukaku });

function mustBeInSameVoice(interaction) {
  const guild = interaction.guild;
  const me = guild?.members?.me;
  const memberVoice = interaction.member?.voice?.channelId;
  const botVoice = me?.voice?.channelId;

  if (!botVoice) return true; // bot pas connecté
  return memberVoice && memberVoice === botVoice;
}

client.on("interactionCreate", async (interaction) => {
  try {
    // Boutons UI
    if (interaction.isButton() && interaction.customId.startsWith("music:")) {
      const action = interaction.customId.split(":")[1];
      const guildId = interaction.guildId;

      if (!guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });
      if (!mustBeInSameVoice(interaction)) {
        return interaction.reply({ content: "❌ Rejoins mon salon vocal pour contrôler la musique.", ephemeral: true });
      }

      // on évite “This interaction failed”
      await interaction.deferUpdate();

      if (action === "toggle") {
        const s = client.music.getSession(guildId);
        if (!s?.player) return;
        await s.player.setPaused(!s.player.paused);
        await client.music.renderController(guildId);
      }

      if (action === "skip") await client.music.skip(guildId);
      if (action === "stop") await client.music.stop(guildId);

      if (action === "loop") {
        client.music.cycleLoop(guildId);
        await client.music.renderController(guildId);
      }

      if (action === "voldown") {
        const s = client.music.getSession(guildId);
        if (!s) return;
        await client.music.setVolume(guildId, Math.max(0, s.volume - 10));
      }

      if (action === "volup") {
        const s = client.music.getSession(guildId);
        if (!s) return;
        await client.music.setVolume(guildId, Math.min(100, s.volume + 10));
      }

      if (action === "queue") {
        const embed = client.music.buildQueueEmbed(guildId);
        await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
      }

      if (action === "refresh") {
        await client.music.renderController(guildId);
      }

      return;
    }

    // Slash commands
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guildId;
    const name = interaction.commandName;

    if (!guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });

    // réponses discrètes, UI publique via panel
    await interaction.deferReply({ ephemeral: true });

    if (name === "play") {
      const query = interaction.options.getString("query", true);
      const source = interaction.options.getString("source") || "ytsearch";
      const msg = await client.music.play(interaction, query, source);
      return interaction.editReply(msg);
    }

    if (!mustBeInSameVoice(interaction)) {
      return interaction.editReply("❌ Rejoins mon salon vocal pour contrôler la musique.");
    }

    if (name === "pause") {
      await client.music.pause(guildId);
      return interaction.editReply("⏸️ Pause.");
    }

    if (name === "resume") {
      await client.music.resume(guildId);
      return interaction.editReply("▶️ Reprise.");
    }

    if (name === "skip") {
      await client.music.skip(guildId);
      return interaction.editReply("⏭️ Skip.");
    }

    if (name === "stop") {
      await client.music.stop(guildId);
      return interaction.editReply("⏹️ Stop + leave.");
    }

    if (name === "volume") {
      const v = interaction.options.getInteger("value", true);
      await client.music.setVolume(guildId, v);
      return interaction.editReply(`🔊 Volume: ${v}%`);
    }

    if (name === "loop") {
      const mode = interaction.options.getString("mode", true);
      const session = client.music.getSession(guildId);
      if (!session) return interaction.editReply("Aucun player actif.");
      session.loop = mode;
      await client.music.renderController(guildId);
      return interaction.editReply(`🔁 Loop: ${mode}`);
    }

    if (name === "queue") {
      const embed = client.music.buildQueueEmbed(guildId);
      return interaction.editReply({ embeds: [embed] });
    }

    if (name === "now") {
      const session = client.music.getSession(guildId);
      if (!session?.current) return interaction.editReply("Aucun titre en cours.");
      const t = session.current.info;
      return interaction.editReply(`🎶 Now: **${t?.title || "Titre"}**`);
    }
  } catch (err) {
    const msg = `❌ ${err?.message || "Erreur inconnue."}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  await registerSlashCommands();
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

client.login(DISCORD_TOKEN);
