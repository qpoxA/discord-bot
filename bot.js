const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ==================== CONFIG (التوكن والإعدادات) ====================
const TOKEN = 'MTM0OTExODYzMDYyMDYxMTIyNA.Gb8O-f.XXXXXXXXXXXXXX'; // حط التوكن الكامل هنا بين الكوتيشن
const CLIENT_ID = '1491018433620611224'; // معرف البوت
const LOG_CHANNEL_ID = '1456113452798971935'; // قناة اللوكات
const TICKET_CHANNEL_ID = '1430332532557222008'; // قناة التكتات
const DB_FILE = './data.json';
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ sessions: {}, alerts: {}, admins: {} }));
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE));
  if (!db.admins) db.admins = {};
  return db;
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getAdminByMinecraft(db, mcName) {
  const lower = mcName.toLowerCase();
  for (const [disc, data] of Object.entries(db.admins)) {
    if (data.minecraftName && data.minecraftName.toLowerCase() === lower) {
      return disc;
    }
  }
  return null;
}

function getAdminByDiscord(db, discName) {
  const lower = discName.toLowerCase();
  for (const key of Object.keys(db.admins)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
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

function parseTicketClose(embed) {
  if (!embed || embed.title !== 'Ticket Closed') return null;
  const fields = embed.fields || [];
  const embedText = fields.map(f => `${f.name}: ${f.value}`).join('\n');
  const creatorMatch = embedText.match(/Creator Username[:\s]+@?(\S+)/i);
  const executorMatch = embedText.match(/Executor Username[:\s]+@?(\S+)/i);
  const descMatch = (embed.description || '').match(/@(\S+)\s+closed a ticket/i);
  const executorUsername = executorMatch ? executorMatch[1].toLowerCase() : (descMatch ? descMatch[1].toLowerCase() : null);
  const creatorUsername = creatorMatch ? creatorMatch[1].toLowerCase() : null;
  if (!executorUsername) return null;
  return { executorUsername, creatorUsername };
}

function calcScore(db, discKey) {
  const data = db.admins[discKey];
  if (!data) return 0;
  let maxTickets = 1, maxMs = 1;
  for (const d of Object.values(db.admins)) {
    if ((d.tickets || 0) > maxTickets) maxTickets = d.tickets || 0;
    let ms = d.totalMs || 0;
    if (d.lastJoin) ms += Date.now() - d.lastJoin;
    if (ms > maxMs) maxMs = ms;
  }
  const tickets = data.tickets || 0;
  let ms = data.totalMs || 0;
  if (data.lastJoin) ms += Date.now() - data.lastJoin;
  const ticketScore = (tickets / maxTickets) * 70;
  const timeScore = (ms / maxMs) * 30;
  return Math.round(ticketScore + timeScore);
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0 دقيقة';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h} ساعة ${m} دقيقة`;
  return `${m} دقيقة`;
}

function scoreBar(score) {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return '🟩'.repeat(filled) + '⬜'.repeat(empty) + ` ${score}%`;
}

client.on('messageCreate', async (message) => {
  if (!message.author.bot) return;
  if (message.channelId === LOG_CHANNEL_ID) {
    let content = message.content;
    if (message.embeds.length > 0) {
      const embed = message.embeds[0];
      content = `${embed.title || ''}\n${embed.description || ''}`;
    }
    const parsed = parseLogMessage(content);
    if (!parsed) return;
    const db = loadDB();
    const { type, player } = parsed;
    const discKey = getAdminByMinecraft(db, player);
    if (!discKey) return;
    const now = Date.now();
    if (!db.admins[discKey].history) db.admins[discKey].history = [];
    if (type === 'join') {
      db.admins[discKey].lastJoin = now;
    } else if (type === 'leave') {
      const joinTime = db.admins[discKey].lastJoin;
      if (joinTime) {
        const duration = now - joinTime;
        db.admins[discKey].totalMs = (db.admins[discKey].totalMs || 0) + duration;
        db.admins[discKey].history.push({ join: joinTime, leave: now, duration });
      }
      db.admins[discKey].lastLeave = now;
      db.admins[discKey].lastJoin = null;
    }
    saveDB(db);
  }
  if (message.channelId === TICKET_CHANNEL_ID) {
    for (const embed of message.embeds) {
      const parsed = parseTicketClose(embed);
      if (!parsed) continue;
      const { executorUsername, creatorUsername } = parsed;
      if (creatorUsername && executorUsername === creatorUsername) continue;
      const db = loadDB();
      const discKey = getAdminByDiscord(db, executorUsername);
      if (!discKey) continue;
      db.admins[discKey].tickets = (db.admins[discKey].tickets || 0) + 1;
      saveDB(db);
    }
  }
});

const commands = [
  new SlashCommandBuilder().setName('addadmin').setDescription('أضف أدمن وربط اسمه').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)).addStringOption(o => o.setName('minecraft').setDescription('اسم الماين').setRequired(true)),
  new SlashCommandBuilder().setName('removeadmin').setDescription('احذف أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('admins').setDescription('قائمة الأدمن المسجلين'),
  new SlashCommandBuilder().setName('score').setDescription('نسبة تفاعل أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('top').setDescription('توب الأدمن حسب التفاعل'),
  new SlashCommandBuilder().setName('lastseen').setDescription('آخر دخول وخروج لأدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('hours').setDescription('إجمالي ساعات أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('tickets').setDescription('عدد تكتات أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('report').setDescription('تقرير الأدمن').addStringOption(o => o.setName('period').setDescription('المدة').setRequired(true).addChoices({ name: 'يومي', value: 'daily' }, { name: 'أسبوعي', value: 'weekly' })),
  new SlashCommandBuilder().setName('online').setDescription('من هو أونلاين الحين؟'),
  new SlashCommandBuilder().setName('alert').setDescription('تنبيه لو أدمن ما دخل X ساعة').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)).addIntegerOption(o => o.setName('hours').setDescription('عدد الساعات').setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
client.once('ready', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  setInterval(checkAlerts, 30 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const db = loadDB();
  if (interaction.commandName === 'addadmin') {
    const discord = interaction.options.getString('discord');
    const minecraft = interaction.options.getString('minecraft');
    db.admins[discord] = { minecraftName: minecraft, tickets: 0, totalMs: 0, history: [], lastJoin: null, lastLeave: null };
    saveDB(db);
    return interaction.reply({ content: `✅ تم ربط **${discord}** بـ **${minecraft}**`, ephemeral: true });
  }
  if (interaction.commandName === 'admins') {
    const list = Object.entries(db.admins);
    if (list.length === 0) return interaction.reply({ content: '❌ ما في أدمن مسجلين', ephemeral: true });
    const embed = new EmbedBuilder().setTitle('👥 قائمة الأدمن').setColor(0x5865F2).setDescription(list.map(([disc, d]) => `**${disc}** ← ⛏️ ${d.minecraftName}`).join('\n'));
    return interaction.reply({ embeds: [embed] });
  }
  // ... (باقي الأوامر تعمل بنفس الطريقة)
});

async function checkAlerts() {
  const db = loadDB();
  if (!db.alerts) return;
  for (const [key, alert] of Object.entries(db.alerts)) {
    const data = db.admins[key];
    if (!data || data.lastJoin) continue;
    const hoursOffline = (Date.now() - (data.lastLeave || 0)) / 3600000;
    if (hoursOffline >= alert.hours) {
      try {
        const channel = await client.channels.fetch(alert.channelId);
        await channel.send(`⚠️ تنبيه: **${key}** ما دخل منذ **${Math.floor(hoursOffline)} ساعة**!`);
        delete db.alerts[key];
        saveDB(db);
      } catch (e) {}
    }
  }
}

client.login(TOKEN);
