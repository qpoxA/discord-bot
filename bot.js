const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ==================== CONFIG ====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1491018433620611224';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1456113452798971935';
const DB_FILE = './data.json';
// ================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ sessions: {}, alerts: {} }));
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanName(raw) {
  let clean = raw.replace(/&#[0-9A-Fa-f]{6}/g, '');
  clean = clean.replace(/&[0-9A-Fa-fk-orK-OR]/g, '');
  clean = clean.replace(/^&+/, '');
  return clean.trim();
}

function parseLogMessage(content) {
  const joinMatch = content.match(/^(.+?) joined the network/m);
  const leftMatch = content.match(/^(.+?) left the network/m);
  if (joinMatch) return { type: 'join', player: cleanName(joinMatch[1]) };
  if (leftMatch) return { type: 'leave', player: cleanName(leftMatch[1]) };
  return null;
}

client.on('messageCreate', async (message) => {
  if (message.channelId !== LOG_CHANNEL_ID) return;
  if (!message.author.bot) return;

  let content = message.content;
  if (message.embeds.length > 0) {
    const embed = message.embeds[0];
    content = `${embed.title || ''}\n${embed.description || ''}`;
  }

  const parsed = parseLogMessage(content);
  if (!parsed) return;

  const db = loadDB();
  const { type, player } = parsed;

  if (!db.sessions[player]) {
    db.sessions[player] = { lastJoin: null, lastLeave: null, totalMs: 0, history: [] };
  }

  const now = Date.now();

  if (type === 'join') {
    db.sessions[player].lastJoin = now;
    console.log(`[JOIN] ${player}`);
  } else if (type === 'leave') {
    const joinTime = db.sessions[player].lastJoin;
    if (joinTime) {
      const duration = now - joinTime;
      db.sessions[player].totalMs += duration;
      db.sessions[player].history.push({ join: joinTime, leave: now, duration });
    }
    db.sessions[player].lastLeave = now;
    db.sessions[player].lastJoin = null;
    console.log(`[LEAVE] ${player}`);
  }

  saveDB(db);
});

const commands = [
  new SlashCommandBuilder()
    .setName('lastseen')
    .setDescription('آخر دخول وخروج لأدمن')
    .addStringOption(opt => opt.setName('player').setDescription('اسم الأدمن').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hours')
    .setDescription('إجمالي ساعات أدمن')
    .addStringOption(opt => opt.setName('player').setDescription('اسم الأدمن').setRequired(true)),

  new SlashCommandBuilder()
    .setName('report')
    .setDescription('تقرير الأدمن')
    .addStringOption(opt =>
      opt.setName('period').setDescription('المدة').setRequired(true)
        .addChoices({ name: 'يومي', value: 'daily' }, { name: 'أسبوعي', value: 'weekly' })
    ),

  new SlashCommandBuilder()
    .setName('alert')
    .setDescription('تنبيه لو أدمن ما دخل X ساعة')
    .addStringOption(opt => opt.setName('player').setDescription('اسم الأدمن').setRequired(true))
    .addIntegerOption(opt => opt.setName('hours').setDescription('عدد الساعات').setRequired(true)),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription('من هو أونلاين الحين؟'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
client.once('ready', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered');
  setInterval(checkAlerts, 30 * 60 * 1000);
});

function formatDuration(ms) {
  if (!ms || ms < 0) return '0 دقيقة';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h} ساعة ${m} دقيقة`;
  return `${m} دقيقة`;
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const db = loadDB();

  if (interaction.commandName === 'lastseen') {
    const player = interaction.options.getString('player');
    const data = db.sessions[player];
    if (!data) return interaction.reply({ content: `❌ ما في سجل لـ **${player}**`, ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle(`📋 سجل ${player}`)
      .setColor(0x5865F2)
      .addFields(
        { name: '🟢 آخر دخول', value: data.lastJoin ? `<t:${Math.floor(data.lastJoin / 1000)}:R>` : 'غير معروف', inline: true },
        { name: '🔴 آخر خروج', value: data.lastLeave ? `<t:${Math.floor(data.lastLeave / 1000)}:R>` : 'غير معروف', inline: true },
        { name: '🟡 الحالة', value: data.lastJoin ? '🟢 أونلاين الحين' : '🔴 أوفلاين', inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'hours') {
    const player = interaction.options.getString('player');
    const data = db.sessions[player];
    if (!data) return interaction.reply({ content: `❌ ما في سجل لـ **${player}**`, ephemeral: true });
    let total = data.totalMs;
    if (data.lastJoin) total += Date.now() - data.lastJoin;
    const embed = new EmbedBuilder()
      .setTitle(`⏱️ ساعات ${player}`)
      .setColor(0x57F287)
      .addFields(
        { name: 'إجمالي الوقت', value: formatDuration(total), inline: false },
        { name: 'عدد الجلسات', value: `${data.history.length} جلسة`, inline: true },
        { name: 'الحالة', value: data.lastJoin ? '🟢 أونلاين' : '🔴 أوفلاين', inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'report') {
    const period = interaction.options.getString('period');
    const cutoff = period === 'daily' ? Date.now() - 86400000 : Date.now() - 604800000;
    const label = period === 'daily' ? 'اليومي' : 'الأسبوعي';
    const lines = [];
    for (const [player, data] of Object.entries(db.sessions)) {
      let ms = data.history.filter(s => s.join >= cutoff).reduce((sum, s) => sum + s.duration, 0);
      if (data.lastJoin && data.lastJoin >= cutoff) ms += Date.now() - data.lastJoin;
      if (ms > 0) lines.push({ player, ms });
    }
    lines.sort((a, b) => b.ms - a.ms);
    const embed = new EmbedBuilder()
      .setTitle(`📊 التقرير ${label}`)
      .setColor(0xFEE75C)
      .setDescription(lines.length === 0 ? 'ما في بيانات للفترة هذي' : lines.map((l, i) => `**${i + 1}.** ${l.player} — ${formatDuration(l.ms)}`).join('\n'))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'alert') {
    const player = interaction.options.getString('player');
    const hours = interaction.options.getInteger('hours');
    if (!db.alerts) db.alerts = {};
    db.alerts[player] = { hours, channelId: interaction.channelId };
    saveDB(db);
    return interaction.reply({ content: `✅ راح أنبهك لو **${player}** ما دخل خلال **${hours} ساعة**`, ephemeral: true });
  }

  if (interaction.commandName === 'online') {
    const online = Object.entries(db.sessions)
      .filter(([, data]) => data.lastJoin)
      .map(([player, data]) => `🟢 **${player}** — دخل <t:${Math.floor(data.lastJoin / 1000)}:R>`);
    const embed = new EmbedBuilder()
      .setTitle('👥 الأدمن أونلاين الحين')
      .setColor(0x57F287)
      .setDescription(online.length > 0 ? online.join('\n') : 'ما في أحد أونلاين الحين')
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }
});

async function checkAlerts() {
  const db = loadDB();
  if (!db.alerts) return;
  for (const [player, alert] of Object.entries(db.alerts)) {
    const data = db.sessions[player];
    if (!data || data.lastJoin) continue;
    const hoursOffline = (Date.now() - (data.lastLeave || 0)) / 3600000;
    if (hoursOffline >= alert.hours) {
      try {
        const channel = await client.channels.fetch(alert.channelId);
        await channel.send(`⚠️ تنبيه: **${player}** ما دخل منذ **${Math.floor(hoursOffline)} ساعة**!`);
        delete db.alerts[player];
        saveDB(db);
      } catch (e) {
        console.error('Alert error:', e);
      }
    }
  }
}

client.login(TOKEN);
