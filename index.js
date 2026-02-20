require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // pour enregistrer vite en serveur (dev)

if (!token || !clientId) {
  console.error("❌ Variables manquantes: DISCORD_TOKEN et/ou CLIENT_ID");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 1) Définir les commandes
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Répond Pong!"),
].map(cmd => cmd.toJSON());

// 2) Enregistrer les commandes (guild = instant, global = peut prendre du temps)
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("✅ Commandes enregistrées (GUILD) !");
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log("✅ Commandes enregistrées (GLOBAL) !");
  }
}

// 3) Démarrer le bot
client.once("ready", () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong! 🏓");
  }
});

(async () => {
  await registerCommands();
  await client.login(token);
})();
