// Ajoute en haut de index.js avec les imports discord.js :
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");

const {
  buildFiltersSelectMenu,
  buildQueueEmbed,
  buildQueuePagerComponents,
} = require("./src/ui/playerUI");

// ... garde le reste de ton index.js identique, puis remplace le listener :
function inSameVoice(interaction) {
  const guild = interaction.guild;
  const me = guild?.members?.me;
  const memberVoice = interaction.member?.voice?.channelId;
  const botVoice = me?.voice?.channelId;

  if (!botVoice) return Boolean(memberVoice); // si bot pas connecté, l'user doit au moins être en vocal (pour play/add)
  return memberVoice && memberVoice === botVoice;
}

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

      const [_, action, extra] = interaction.customId.split(":");
      const session = client.music.getSession(guildId);

      // Actions info (peuvent répondre ephemeral sans deferUpdate)
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

      // Actions “control” => require same voice
      if (!inSameVoice(interaction)) {
        return interaction.reply({ content: "❌ Rejoins mon salon vocal pour contrôler la musique.", ephemeral: true });
      }

      // Pour éviter “This interaction failed”
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

    // pour les autres, il faut être dans le même vocal
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
