const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ==================== CONFIG (إعدادات البيئة) ====================
// ملاحظة: لا تضع التوكن هنا، ضعه في إعدادات Railway باسم DISCORD_TOKEN
const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = '1491018433620611224'; 
const LOG_CHANNEL_ID = '1456113452798971935'; 
const TICKET_CHANNEL_ID = '1430332532557222008'; 
const DB_FILE = './data.json';
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// --- وظائف قاعدة البيانات ---
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

// --- وظائف المساعدة والبحث ---
function getAdminByMinecraft(db, mcName) {
  const lower = mcName.toLowerCase();
  for (const [disc, data] of Object.entries(db.admins)) {
    if (data.minecraftName && data.minecraftName.toLowerCase() === lower) return disc;
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
  return raw.replace(/&#[0-9A-Fa-f]{6}/g, '').replace(/&[0-9A-Fa-fk-orK-OR]/g, '').replace(/^&+/, '').trim();
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
    let ms = (d.totalMs || 0) + (d.lastJoin ? Date.now() - d.lastJoin : 0);
    if (ms > maxMs) maxMs = ms;
  }
  const tickets = data.tickets || 0;
  let ms = (data.totalMs || 0) + (data.lastJoin ? Date.now() - data.lastJoin : 0);
  return Math.round(((tickets / maxTickets) * 70) + ((ms / maxMs) * 30));
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0 دقيقة';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} ساعة ${m} دقيقة` : `${m} دقيقة`;
}

function scoreBar(score) {
  const filled = Math.round(score / 10);
  return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled) + ` ${score}%`;
}

// --- معالجة الرسائل واللوكات ---
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

    if (type === 'join') {
      db.admins[discKey].lastJoin = Date.now();
    } else {
      const joinTime = db.admins[discKey].lastJoin;
      if (joinTime) {
        const duration = Date.now() - joinTime;
        db.admins[discKey].totalMs = (db.admins[discKey].totalMs || 0) + duration;
        if (!db.admins[discKey].history) db.admins[discKey].history = [];
        db.admins[discKey].history.push({ join: joinTime, leave: Date.now(), duration });
      }
      db.admins[discKey].lastLeave = Date.now();
      db.admins[discKey].lastJoin = null;
    }
    saveDB(db);
  }

  if (message.channelId === TICKET_CHANNEL_ID) {
    for (const embed of message.embeds) {
      const parsed = parseTicketClose(embed);
      if (!parsed) continue;
      if (parsed.creatorUsername && parsed.executorUsername === parsed.creatorUsername) continue;
      const db = loadDB();
      const discKey = getAdminByDiscord(db, parsed.executorUsername);
      if (discKey) {
        db.admins[discKey].tickets = (db.admins[discKey].tickets || 0) + 1;
        saveDB(db);
      }
    }
  }
});

// --- الأوامر ---
const commands = [
  new SlashCommandBuilder().setName('addadmin').setDescription('أضف أدمن وربط اسمه').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)).addStringOption(o => o.setName('minecraft').setDescription('اسم الماين').setRequired(true)),
  new SlashCommandBuilder().setName('admins').setDescription('قائمة الأدمن المسجلين'),
  new SlashCommandBuilder().setName('score').setDescription('تقييم تفاعل أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('top').setDescription('توب الأدمن حسب التفاعل'),
  new SlashCommandBuilder().setName('hours').setDescription('إجمالي ساعات أدمن').addStringOption(o => o.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('online').setDescription('من هو أونلاين الحين؟')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commands registered successfully');
  } catch (err) { console.error(err); }
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
    if (list.length === 0) return interaction.reply('❌ لا يوجد مشرفين مسجلين.');
    const embed = new EmbedBuilder().setTitle('👥 قائمة الأدمن').setColor(0x5865F2).setDescription(list.map(([disc, d]) => `**${disc}** ← ⛏️ ${d.minecraftName}`).join('\n'));
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'score') {
    const disc = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return interaction.reply('❌ الأدمن غير موجود.');
    const score = calcScore(db, key);
    const embed = new EmbedBuilder().setTitle(`📊 تقييم التفاعل: ${key}`).setColor(0x00FF00).setDescription(`${scoreBar(score)}\n\nتكتات: ${db.admins[key].tickets || 0}\nساعات: ${formatDuration(db.admins[key].totalMs)}`);
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'top') {
    const sorted = Object.keys(db.admins).sort((a, b) => calcScore(db, b) - calcScore(db, a)).slice(0, 10);
    const list = sorted.map((key, i) => `${i + 1}. **${key}** - ${calcScore(db, key)}%`).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 توب التفاعل').setDescription(list).setColor(0xF1C40F)] });
  }

  if (interaction.commandName === 'hours') {
    const disc = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return interaction.reply('❌ الأدمن غير موجود.');
    return interaction.reply(`🕒 إجمالي ساعات **${key}** هي: **${formatDuration(db.admins[key].totalMs)}**`);
  }

  if (interaction.commandName === 'online') {
    const online = Object.entries(db.admins).filter(([_, d]) => d.lastJoin !== null);
    if (online.length === 0) return interaction.reply('🚫 لا يوجد مشرفين أونلاين.');
    const list = online.map(([disc, d]) => `🟢 **${disc}** (منذ ${formatDuration(Date.now() - d.lastJoin)})`).join('\n');
    return interaction.reply(`👥 **المتصلون الآن:**\n${list}`);
  }
});

client.login(TOKEN);
