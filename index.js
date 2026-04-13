const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ==================== CONFIG ====================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1491018433620611224';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1456113452798971935';
const TICKET_CHANNEL_ID = '1430332532557222008';
const DB_FILE = './data.json';
// ================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// --- إدارة قاعدة البيانات ---
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ admins: {}, alerts: {} }));
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE));
  if (!db.admins) db.admins = {};
  if (!db.alerts) db.alerts = {};
  return db;
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --- وظائف المساعدة ---
function getAdminByMinecraft(db, mcName) {
  const lower = mcName.toLowerCase();
  for (const [disc, data] of Object.entries(db.admins)) {
    if (data.minecraftName && data.minecraftName.toLowerCase() === lower) return disc;
  }
  return null;
}

function getAdminByDiscord(db, discName) {
  const lower = discName.toLowerCase().replace('@', '');
  for (const key of Object.keys(db.admins)) {
    if (key.toLowerCase().replace('@', '') === lower) return key;
  }
  return null;
}

function cleanName(raw) {
  return raw.replace(/&#[0-9A-Fa-f]{6}/g, '').replace(/&[0-9A-Fa-fk-orK-OR]/g, '').replace(/^&+/, '').trim();
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0 دقيقة';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} ساعة ${m} دقيقة` : `${m} دقيقة`;
}

function scoreBar(score) {
  const filled = Math.round(Math.min(score, 100) / 10);
  return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled) + ` ${score}%`;
}

function calcScore(db, discKey) {
  const data = db.admins[discKey];
  if (!data) return 0;
  let maxTickets = 1, maxMs = 1;
  for (const d of Object.values(db.admins)) {
    maxTickets = Math.max(maxTickets, d.tickets || 0);
    let ms = (d.totalMs || 0) + (d.lastJoin ? Date.now() - d.lastJoin : 0);
    maxMs = Math.max(maxMs, ms);
  }
  const tickets = data.tickets || 0;
  let ms = (data.totalMs || 0) + (data.lastJoin ? Date.now() - data.lastJoin : 0);
  return Math.round(((tickets / maxTickets) * 70) + ((ms / maxMs) * 30));
}

// --- التتبع (Logs & Tickets) ---
client.on('messageCreate', async (message) => {
  if (!message.author.bot) return;
  const db = loadDB();

  // تتبع الدخول والخروج
  if (message.channelId === LOG_CHANNEL_ID) {
    let content = message.embeds.length > 0 ? `${message.embeds[0].title}\n${message.embeds[0].description}` : message.content;
    const joinMatch = content.match(/^(.+?) joined the network/m);
    const leftMatch = content.match(/^(.+?) left the network/m);

    if (joinMatch) {
      const player = cleanName(joinMatch[1]);
      const discKey = getAdminByMinecraft(db, player);
      if (discKey) {
        db.admins[discKey].lastJoin = Date.now();
        saveDB(db);
      }
    } else if (leftMatch) {
      const player = cleanName(leftMatch[1]);
      const discKey = getAdminByMinecraft(db, player);
      if (discKey && db.admins[discKey].lastJoin) {
        const duration = Date.now() - db.admins[discKey].lastJoin;
        db.admins[discKey].totalMs = (db.admins[discKey].totalMs || 0) + duration;
        db.admins[discKey].lastLeave = Date.now();
        db.admins[discKey].lastJoin = null;
        saveDB(db);
      }
    }
  }

  // تتبع التذاكر
  if (message.channelId === TICKET_CHANNEL_ID) {
    for (const embed of message.embeds) {
      if (embed.title === 'Ticket Closed') {
        const fields = embed.fields || [];
        const executorField = fields.find(f => f.name.includes('Executor'));
        if (executorField) {
          const execName = executorField.value.replace('@', '').toLowerCase();
          const discKey = getAdminByDiscord(db, execName);
          if (discKey) {
            db.admins[discKey].tickets = (db.admins[discKey].tickets || 0) + 1;
            saveDB(db);
          }
        }
      }
    }
  }
});

// --- Slash Commands Setup ---
const commands = [
  new SlashCommandBuilder().setName('addadmin').setDescription('إضافة أدمن جديد').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)).addStringOption(o => o.setName('minecraft').setDescription('يوزر الماين').setRequired(true)),
  new SlashCommandBuilder().setName('removeadmin').setDescription('حذف أدمن').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('admins').setDescription('قائمة الأدمن'),
  new SlashCommandBuilder().setName('score').setDescription('تفاعل أدمن').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('top').setDescription('توب التفاعل'),
  new SlashCommandBuilder().setName('hours').setDescription('ساعات أدمن').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('online').setDescription('المتصلون الآن'),
  new SlashCommandBuilder().setName('lastseen').setDescription('آخر ظهور').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('alert').setDescription('تنبيه غياب').addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)).addIntegerOption(o => o.setName('hours').setDescription('عدد الساعات').setRequired(true)),
  new SlashCommandBuilder().setName('report').setDescription('تقرير شامل').addStringOption(o => o.setName('period').setDescription('المدة').setRequired(true).addChoices({name:'يومي',value:'daily'},{name:'أسبوعي',value:'weekly'}))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} جاهز!`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  setInterval(checkAlerts, 15 * 60 * 1000); // فحص التنبيهات كل 15 دقيقة
});

// --- معالجة الأوامر ---
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  const db = loadDB();

  if (i.commandName === 'addadmin') {
    const disc = i.options.getString('discord');
    const mc = i.options.getString('minecraft');
    db.admins[disc] = { minecraftName: mc, tickets: 0, totalMs: 0, lastJoin: null, lastLeave: null };
    saveDB(db);
    return i.reply(`✅ تم ربط **${disc}** بـ **${mc}**`);
  }

  if (i.commandName === 'admins') {
    const list = Object.entries(db.admins).map(([disc, d]) => `**${disc}** ← ⛏️ ${d.minecraftName}`).join('\n');
    return i.reply({ embeds: [new EmbedBuilder().setTitle('👥 قائمة الأدمن').setDescription(list || 'لا يوجد أدمينات')] });
  }

  if (i.commandName === 'score') {
    const disc = i.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return i.reply('❌ غير موجود.');
    const score = calcScore(db, key);
    return i.reply({ embeds: [new EmbedBuilder().setTitle(`📊 تفاعل ${key}`).setDescription(`${scoreBar(score)}\n🎫 تكتات: ${db.admins[key].tickets || 0}`)] });
  }

  if (i.commandName === 'online') {
    const online = Object.entries(db.admins).filter(([_, d]) => d.lastJoin).map(([k, d]) => `🟢 **${k}** (دخل <t:${Math.floor(d.lastJoin/1000)}:R>)`);
    return i.reply(online.length > 0 ? online.join('\n') : '🚫 لا يوجد أحد متصل');
  }

  if (i.commandName === 'alert') {
    const disc = i.options.getString('discord');
    const hrs = i.options.getInteger('hours');
    const key = getAdminByDiscord(db, disc);
    if (!key) return i.reply('❌ الأدمن غير مسجل.');
    db.alerts[key] = { hours: hrs, channelId: i.channelId };
    saveDB(db);
    return i.reply(`✅ سيتم تنبيهك هنا لو غاب **${key}** لأكثر من **${hrs}** ساعة.`);
  }
  
  // يمكنك استكمال بقية الأوامر (hours, lastseen, report) بنفس النمط...
});

async function checkAlerts() {
  const db = loadDB();
  for (const [key, alert] of Object.entries(db.alerts)) {
    const data = db.admins[key];
    if (!data || data.lastJoin) continue;
    const hrsOffline = (Date.now() - (data.lastLeave || 0)) / 3600000;
    if (hrsOffline >= alert.hours) {
      const channel = await client.channels.fetch(alert.channelId);
      if (channel) channel.send(`⚠️ تنبيه: **${key}** غائب منذ **${Math.floor(hrsOffline)}** ساعة!`);
      delete db.alerts[key];
      saveDB(db);
    }
  }
}

client.login(TOKEN);
