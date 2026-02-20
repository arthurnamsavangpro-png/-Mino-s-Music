// index.js
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// Si tu mets GUILD_ID, les commandes apparaissent instantanément sur ton serveur de test :
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant (Railway > Variables).");
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID manquant (Railway > Variables).");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

/** Slash commands */
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Voir la latence du bot"),
  new SlashCommandBuilder().setName("help").setDescription("Afficher l'aide du bot"),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
      console.log("✅ Commandes enregistrées (GUILD) !");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Commandes enregistrées (GLOBAL) !");
    }
  } catch (err) {
    console.error("❌ Erreur enregistrement commandes:", err);
  }
}

function prettyUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

client.once("ready", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("GitHub")
      .setStyle(ButtonStyle.Link)
      .setURL("https://github.com/arthurnamsavangpro-png/-Mino-s-Music")
  );

  if (interaction.commandName === "ping") {
    const embed = new EmbedBuilder()
      .setTitle("🏓 Pong !")
      .setDescription("Latence & état du bot")
      .addFields(
        { name: "📡 WebSocket", value: `\`${client.ws.ping}ms\``, inline: true },
        { name: "⏱️ Uptime", value: `\`${prettyUptime(client.uptime)}\``, inline: true },
        { name: "🧠 Node", value: `\`${process.version}\``, inline: true }
      )
      .setFooter({ text: "Mino's Music • Railway" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
  }

  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("✨ Aide du bot")
      .setDescription("Commandes disponibles :")
      .addFields(
        { name: "/ping", value: "Affiche la latence et l'uptime", inline: false },
        { name: "/help", value: "Affiche ce menu d'aide", inline: false }
      )
      .setFooter({ text: "Prochaine étape : ajouter musique (Lavalink ou ytdl)" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
});

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
