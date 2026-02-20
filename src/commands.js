const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joue une musique (recherche ou URL).")
    .addStringOption((o) =>
      o.setName("query").setDescription("Nom/URL").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("source")
        .setDescription("Source de recherche (si tu donnes un nom)")
        .addChoices(
          { name: "YouTube", value: "ytsearch" },
          { name: "SoundCloud", value: "scsearch" }
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder().setName("pause").setDescription("Met en pause."),
  new SlashCommandBuilder().setName("resume").setDescription("Reprend."),
  new SlashCommandBuilder().setName("skip").setDescription("Passe au suivant."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop + quitte le vocal."),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Change le volume (0-100).")
    .addIntegerOption((o) =>
      o.setName("value").setDescription("0-100").setMinValue(0).setMaxValue(100).setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Change le mode boucle.")
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("off | track | queue")
        .addChoices(
          { name: "off", value: "off" },
          { name: "track", value: "track" },
          { name: "queue", value: "queue" }
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName("queue").setDescription("Affiche la file d’attente."),
  new SlashCommandBuilder().setName("now").setDescription("Affiche le titre en cours."),
].map((c) => c.toJSON());

module.exports = { commands };
