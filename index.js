// index.js
require("dotenv").config();

// (Optionnel mais recommandé Railway) : préfère IPv4
const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");

const { Shoukaku, Connectors } = require("shoukaku");
const { commands } = require("./src/commands");
const { MusicManager } = require("./src/music/MusicManager");

const {
  buildFiltersSelectMenu,
  buildQueueEmbed,
  buildQueuePagerComponents,
} = require("./src/ui/playerUI");

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

// ✅ IMPORTANT : client est défini AVANT tous les client.on(...)
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

// Music manager
client.music = new MusicManager({ client, shoukaku });

function inSameVoice(interaction) {
  const guild = interaction.guild;
  const me = guild?.members?.me;
  const memberVoice = interaction.member?.voice?.channelId;
  const botVoice = me?.voice?.channelId;

  // Si bot pas connecté : l'user doit au moins être en vocal (pour play/add)
  if (!botVoice) return Boolean(memberVoice);

  // Sinon : même vocal
  return memberVoice && memberVoice === botVoice;
}

// ✅ Ton interactionCreate doit être APRES la création de client
client.on("interactionCreate", async (interaction) => {
  try {
    // ===== MODAL SUBMIT (Add track) =====
    if (interaction.isModalSubmit() && interaction.customId === "music:addModal") {
      if (!interaction.guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });
      if (!inSameVoice(interaction)) {
        return interaction.reply({ content: "❌ Rejoins mon salon vocal pour ajouter une musique.", ephemeral: true });
      }

      const query = interaction.fields.getTextInputValue("music:addQuery")?.trim();
      if (!query) return interaction.reply({ content: "❌ Tu n'as rien mis.", ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const msg = await client.music.play(interaction, query, "ytsearch");
      return interaction.editReply(msg);
    }

    // ===== SELECT MENU (Filters) =====
    if (interaction.isStringSelectMenu() && interaction.customId === "music:filtersSelect") {
      if (!interaction.guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });
      if (!inSameVoice(interaction)) {
        return interaction.reply({ content: "❌ Rejoins mon salon vocal pour changer les filtres.", ephemeral: true });
      }

      const preset = interaction.values?.[0] || "none";
      await interaction.deferUpdate();
      await client.music.setFilterPreset(interaction.guildId, preset);
      return;
    }

    // ===== BUTTONS =====
    if (interaction.isButton() && interaction.customId.startsWith("music:")) {
      const guildId = interaction.guildId;
      if (!guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });

      // Format: music:action  OU music:queuePage:2
      const parts = interaction.customId.split(":");
      const action = parts[1];
      const extra = parts[2];

      const session = client.music.getSession(guildId);

      // UI ephemeral
      if (action === "queue") {
        const s = client.music.getSession(guildId);
        const { embed, page, totalPages } = buildQueueEmbed(s, 1, 10);
        return interaction.reply({
          embeds: [embed],
          components: buildQueuePagerComponents(page, totalPages),
          ephemeral: true,
        });
      }

      if (action === "queueClose") {
        return interaction.update({ content: "✅ Fermé.", embeds: [], components: [] });
      }

      if (action === "queuePage") {
        const targetPage = Number(extra || 1);
        const s = client.music.getSession(guildId);
        const { embed, page, totalPages } = buildQueueEmbed(s, targetPage, 10);
        return interaction.update({
          embeds: [embed],
          components: buildQueuePagerComponents(page, totalPages),
        });
      }

      if (action === "filters") {
        const preset = session?.filters?.preset || "none";
        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setTitle("🎚️ Filters — Dark Luxe")
          .setDescription("Choisis un preset. (Tu dois être dans le même vocal que le bot.)");

        return interaction.reply({
          embeds: [embed],
          components: [buildFiltersSelectMenu(preset)],
          ephemeral: true,
        });
      }

      if (action === "add") {
        if (!inSameVoice(interaction)) {
          return interaction.reply({ content: "❌ Rejoins mon salon vocal pour ajouter une musique.", ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId("music:addModal").setTitle("➕ Add a track");
        const input = new TextInputBuilder()
          .setCustomId("music:addQuery")
          .setLabel("Nom / URL")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("ex: daft punk one more time / https://...")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      // Controls require same voice
      if (!inSameVoice(interaction)) {
        return interaction.reply({ content: "❌ Rejoins mon salon vocal pour contrôler la musique.", ephemeral: true });
      }

      await interaction.deferUpdate();

      if (action === "toggle") return client.music.toggle(guildId);
      if (action === "prev") return client.music.previous(guildId);
      if (action === "skip") return client.music.skip(guildId);
      if (action === "stop") return client.music.stop(guildId);

      if (action === "loop") {
        client.music.cycleLoop(guildId);
        return client.music.renderController(guildId);
      }

      if (action === "shuffle") {
        client.music.shuffle(guildId);
        return client.music.renderController(guildId);
      }

      if (action === "clear") {
        client.music.clearQueue(guildId);
        return client.music.renderController(guildId);
      }

      if (action === "voldown") return client.music.volumeDown(guildId, 10);
      if (action === "volup") return client.music.volumeUp(guildId, 10);

      if (action === "seekback") return client.music.seekRelative(guildId, -10_000);
      if (action === "seekfwd") return client.music.seekRelative(guildId, 10_000);

      if (action === "refresh") return client.music.renderController(guildId);

      return;
    }

    // ===== SLASH COMMANDS =====
    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guildId;
    const name = interaction.commandName;

    if (!guildId) return interaction.reply({ content: "Serveur requis.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    if (name === "play") {
      const query = interaction.options.getString("query", true);
      const source = interaction.options.getString("source") || "ytsearch";
      const msg = await client.music.play(interaction, query, source);
      return interaction.editReply(msg);
    }

    if (!inSameVoice(interaction)) {
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
      return interaction.editReply(`🔊 Volume: ${v}`);
    }

    if (name === "loop") {
      const mode = interaction.options.getString("mode", true);
      const s = client.music.getSession(guildId);
      if (!s) return interaction.editReply("Aucun player actif.");
      s.loop = mode;
      await client.music.renderController(guildId);
      return interaction.editReply(`🔁 Loop: ${mode}`);
    }

    if (name === "queue") {
      const embed = client.music.buildQueueEmbed(guildId);
      return interaction.editReply({ embeds: [embed] });
    }

    if (name === "now") {
      const s = client.music.getSession(guildId);
      if (!s?.current) return interaction.editReply("Aucun titre en cours.");
      const t = s.current.info;
      return interaction.editReply(`🎧 Now: **${t?.title || "Titre"}**`);
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
  await registerSlashCommands().catch((e) => console.error("registerSlashCommands:", e));
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

client.login(DISCORD_TOKEN);
