const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ==================== CONFIG (إعدادات البيئة) ====================
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
    fs.writeFileSync(DB_FILE, JSON.stringify({ admins: {} }));
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE));
  if (!db.admins) db.admins = {};
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

function formatDuration(ms) {
  if (!ms || ms < 0) return '0 دقيقة';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} ساعة ${m} دقيقة` : `${m} دقيقة`;
}

function cleanName(raw) {
  return raw.replace(/&#[0-9A-Fa-f]{6}/g, '').replace(/&[0-9A-Fa-fk-orK-OR]/g, '').replace(/^&+/, '').trim();
}

// --- معالجة تسجيل الدخول والخروج من اللوكات ---
client.on('messageCreate', async (message) => {
  if (!message.author.bot || message.channelId !== LOG_CHANNEL_ID) return;

  let content = message.content;
  if (message.embeds.length > 0) {
    const embed = message.embeds[0];
    content = `${embed.title || ''}\n${embed.description || ''}`;
  }

  const joinMatch = content.match(/^(.+?) joined the network/m);
  const leftMatch = content.match(/^(.+?) left the network/m);
  
  const db = loadDB();
  if (joinMatch) {
    const player = cleanName(joinMatch[1]);
    const discKey = getAdminByMinecraft(db, player);
    if (discKey) db.admins[discKey].lastJoin = Date.now();
  } else if (leftMatch) {
    const player = cleanName(leftMatch[1]);
    const discKey = getAdminByMinecraft(db, player);
    if (discKey && db.admins[discKey].lastJoin) {
      const duration = Date.now() - db.admins[discKey].lastJoin;
      db.admins[discKey].totalMs = (db.admins[discKey].totalMs || 0) + duration;
      db.admins[discKey].lastLeave = Date.now();
      db.admins[discKey].lastJoin = null;
    }
  }
  saveDB(db);
});

// --- الأوامر ---
const commands = [
  new SlashCommandBuilder().setName('addadmin').setDescription('إضافة أدمن جديد')
    .addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true))
    .addStringOption(o => o.setName('minecraft').setDescription('يوزر ماين كرافت').setRequired(true)),
  new SlashCommandBuilder().setName('hours').setDescription('عرض ساعات الإدارة')
    .addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('online').setDescription('من متصل الآن؟'),
  new SlashCommandBuilder().setName('lastseen').setDescription('آخر ظهور للأدمن')
    .addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('report').setDescription('تقرير شامل للأدمن')
    .addStringOption(o => o.setName('discord').setDescription('يوزر الديسكورد').setRequired(true)),
  new SlashCommandBuilder().setName('alert').setDescription('تنبيه الغياب')
    .addIntegerOption(o => o.setName('hours').setDescription('عدد الساعات').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} يعمل الآن!`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ تم تحديث الأوامر بنجاح');
  } catch (err) { console.error(err); }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const db = loadDB();

  if (interaction.commandName === 'addadmin') {
    const discord = interaction.options.getString('discord');
    const minecraft = interaction.options.getString('minecraft');
    db.admins[discord] = { minecraftName: minecraft, tickets: 0, totalMs: 0, lastJoin: null, lastLeave: null };
    saveDB(db);
    return interaction.reply(`✅ تم إضافة **${discord}** وربطه بـ **${minecraft}**`);
  }

  if (interaction.commandName === 'hours') {
    const disc = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return interaction.reply('❌ هذا الأدمن غير مسجل.');
    return interaction.reply(`🕒 إجمالي ساعات **${key}**: **${formatDuration(db.admins[key].totalMs)}**`);
  }

  if (interaction.commandName === 'online') {
    const online = Object.entries(db.admins).filter(([_, d]) => d.lastJoin !== null);
    if (online.length === 0) return interaction.reply('🚫 لا يوجد أحد متصل حالياً.');
    const list = online.map(([disc, d]) => `🟢 **${disc}** (منذ ${formatDuration(Date.now() - d.lastJoin)})`).join('\n');
    return interaction.reply(`👥 **المتصلون الآن:**\n${list}`);
  }

  if (interaction.commandName === 'lastseen') {
    const disc = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return interaction.reply('❌ غير موجود.');
    const admin = db.admins[key];
    const time = admin.lastLeave ? `<t:${Math.floor(admin.lastLeave / 1000)}:R>` : 'لم يسجل خروج بعد';
    return interaction.reply(`👁️ آخر ظهور لـ **${key}** كان: ${time}`);
  }

  if (interaction.commandName === 'report') {
    const disc = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, disc);
    if (!key) return interaction.reply('❌ غير موجود.');
    const admin = db.admins[key];
    const embed = new EmbedBuilder()
      .setTitle(`📊 تقرير الإدارة: ${key}`)
      .setColor(0x2ECC71)
      .addFields(
        { name: 'اسم الماين كرافت', value: admin.minecraftName, inline: true },
        { name: 'إجمالي الساعات', value: formatDuration(admin.totalMs), inline: true },
        { name: 'الحالة الآن', value: admin.lastJoin ? '🟢 متصل' : '🔴 غير متصل', inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'alert') {
    const hrs = interaction.options.getInteger('hours');
    return interaction.reply(`🔔 سيتم تنبيهك عند غياب أي أدمن لمدة تزيد عن **${hrs}** ساعة.`);
  }
});

client.login(TOKEN);
