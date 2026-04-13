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

// admins = { discordUsername: { minecraftName, tickets, totalMs, history, lastJoin, lastLeave } }

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

// Calculate activity score: 70% tickets, 30% online time
function calcScore(db, discKey) {
  const data = db.admins[discKey];
  if (!data) return 0;

  // Max values across all admins for normalization
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

// --- Message listener ---
client.on('messageCreate', async (message) => {
  if (!message.author.bot) return;

  // Track server sessions
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
    if (!discKey) return; // Only track registered admins

    const now = Date.now();
    if (!db.admins[discKey].history) db.admins[discKey].history = [];

    if (type === 'join') {
      db.admins[discKey].lastJoin = now;
      console.log(`[JOIN] ${player} (${discKey})`);
    } else if (type === 'leave') {
      const joinTime = db.admins[discKey].lastJoin;
      if (joinTime) {
        const duration = now - joinTime;
        db.admins[discKey].totalMs = (db.admins[discKey].totalMs || 0) + duration;
        db.admins[discKey].history.push({ join: joinTime, leave: now, duration });
      }
      db.admins[discKey].lastLeave = now;
      db.admins[discKey].lastJoin = null;
      console.log(`[LEAVE] ${player} (${discKey})`);
    }
    saveDB(db);
  }

  // Track ticket closes
  if (message.channelId === TICKET_CHANNEL_ID) {
    for (const embed of message.embeds) {
      const parsed = parseTicketClose(embed);
      if (!parsed) continue;
      const { executorUsername, creatorUsername } = parsed;
      if (creatorUsername && executorUsername === creatorUsername) {
        console.log(`[TICKET] Skipped self-close by ${executorUsername}`);
        continue;
      }
      const db = loadDB();
      const discKey = getAdminByDiscord(db, executorUsername);
      if (!discKey) {
        console.log(`[TICKET] ${executorUsername} not registered`);
        continue;
      }
      db.admins[discKey].tickets = (db.admins[discKey].tickets || 0) + 1;
      saveDB(db);
      console.log(`[TICKET] ${discKey} closed a ticket → total: ${db.admins[discKey].tickets}`);
    }
  }
});

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName('addadmin')
    .setDescription('أضف أدمن وربط اسمه')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true))
    .addStringOption(opt => opt.setName('minecraft').setDescription('اسم الماين').setRequired(true)),

  new SlashCommandBuilder()
    .setName('removeadmin')
    .setDescription('احذف أدمن')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('admins')
    .setDescription('قائمة الأدمن المسجلين'),

  new SlashCommandBuilder()
    .setName('score')
    .setDescription('نسبة تفاعل أدمن')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('توب الأدمن حسب التفاعل'),

  new SlashCommandBuilder()
    .setName('lastseen')
    .setDescription('آخر دخول وخروج لأدمن')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hours')
    .setDescription('إجمالي ساعات أدمن')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('عدد تكتات أدمن')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true)),

  new SlashCommandBuilder()
    .setName('report')
    .setDescription('تقرير الأدمن')
    .addStringOption(opt =>
      opt.setName('period').setDescription('المدة').setRequired(true)
        .addChoices({ name: 'يومي', value: 'daily' }, { name: 'أسبوعي', value: 'weekly' })
    ),

  new SlashCommandBuilder()
    .setName('online')
    .setDescription('من هو أونلاين الحين؟'),

  new SlashCommandBuilder()
    .setName('alert')
    .setDescription('تنبيه لو أدمن ما دخل X ساعة')
    .addStringOption(opt => opt.setName('discord').setDescription('اسم الديسكورد').setRequired(true))
    .addIntegerOption(opt => opt.setName('hours').setDescription('عدد الساعات').setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
client.once('ready', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered');
  setInterval(checkAlerts, 30 * 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const db = loadDB();

  // /addadmin
  if (interaction.commandName === 'addadmin') {
    const discord = interaction.options.getString('discord');
    const minecraft = interaction.options.getString('minecraft');
    db.admins[discord] = { minecraftName: minecraft, tickets: 0, totalMs: 0, history: [], lastJoin: null, lastLeave: null };
    saveDB(db);
    return interaction.reply({ content: `✅ تم ربط **${discord}** (ديسكورد) بـ **${minecraft}** (ماين)`, ephemeral: true });
  }

  // /removeadmin
  if (interaction.commandName === 'removeadmin') {
    const discord = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    delete db.admins[key];
    saveDB(db);
    return interaction.reply({ content: `✅ تم حذف **${key}**`, ephemeral: true });
  }

  // /admins
  if (interaction.commandName === 'admins') {
    const list = Object.entries(db.admins);
    if (list.length === 0) return interaction.reply({ content: '❌ ما في أدمن مسجلين', ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle('👥 قائمة الأدمن')
      .setColor(0x5865F2)
      .setDescription(list.map(([disc, d]) => `**${disc}** ← ⛏️ ${d.minecraftName}`).join('\n'))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /score
  if (interaction.commandName === 'score') {
    const discord = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    const data = db.admins[key];
    const score = calcScore(db, key);
    let ms = data.totalMs || 0;
    if (data.lastJoin) ms += Date.now() - data.lastJoin;
    const embed = new EmbedBuilder()
      .setTitle(`📊 تفاعل ${key}`)
      .setColor(score >= 70 ? 0x57F287 : score >= 40 ? 0xFEE75C : 0xED4245)
      .addFields(
        { name: '🎯 النسبة الكلية', value: scoreBar(score), inline: false },
        { name: '🎫 التكتات (70%)', value: `${data.tickets || 0} تكت`, inline: true },
        { name: '⏱️ الوقت (30%)', value: formatDuration(ms), inline: true },
        { name: '⛏️ اسم الماين', value: data.minecraftName || 'غير محدد', inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /top
  if (interaction.commandName === 'top') {
    const ranked = Object.keys(db.admins)
      .map(key => ({ key, score: calcScore(db, key) }))
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) return interaction.reply({ content: '❌ ما في أدمن مسجلين', ephemeral: true });
    const medals = ['🥇', '🥈', '🥉'];
    const embed = new EmbedBuilder()
      .setTitle('🏆 توب الأدمن')
      .setColor(0xFEE75C)
      .setDescription(ranked.map((r, i) => `${medals[i] || `**${i + 1}.**`} **${r.key}** — ${scoreBar(r.score)}`).join('\n'))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /lastseen
  if (interaction.commandName === 'lastseen') {
    const discord = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    const data = db.admins[key];
    const embed = new EmbedBuilder()
      .setTitle(`📋 سجل ${key}`)
      .setColor(0x5865F2)
      .addFields(
        { name: '🟢 آخر دخول', value: data.lastJoin ? `<t:${Math.floor(data.lastJoin / 1000)}:R>` : 'غير معروف', inline: true },
        { name: '🔴 آخر خروج', value: data.lastLeave ? `<t:${Math.floor(data.lastLeave / 1000)}:R>` : 'غير معروف', inline: true },
        { name: '🟡 الحالة', value: data.lastJoin ? '🟢 أونلاين الحين' : '🔴 أوفلاين', inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /hours
  if (interaction.commandName === 'hours') {
    const discord = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    const data = db.admins[key];
    let total = data.totalMs || 0;
    if (data.lastJoin) total += Date.now() - data.lastJoin;
    const embed = new EmbedBuilder()
      .setTitle(`⏱️ ساعات ${key}`)
      .setColor(0x57F287)
      .addFields(
        { name: 'إجمالي الوقت', value: formatDuration(total), inline: false },
        { name: 'عدد الجلسات', value: `${(data.history || []).length} جلسة`, inline: true },
        { name: 'الحالة', value: data.lastJoin ? '🟢 أونلاين' : '🔴 أوفلاين', inline: true },
      ).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /tickets
  if (interaction.commandName === 'tickets') {
    const discord = interaction.options.getString('discord');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    const data = db.admins[key];
    const embed = new EmbedBuilder()
      .setTitle(`🎫 تكتات ${key}`)
      .setColor(0xEB459E)
      .addFields({ name: 'عدد التكتات المغلقة', value: `${data.tickets || 0} تكت`, inline: false })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /report
  if (interaction.commandName === 'report') {
    const period = interaction.options.getString('period');
    const cutoff = period === 'daily' ? Date.now() - 86400000 : Date.now() - 604800000;
    const label = period === 'daily' ? 'اليومي' : 'الأسبوعي';
    const lines = [];
    for (const [key, data] of Object.entries(db.admins)) {
      let ms = (data.history || []).filter(s => s.join >= cutoff).reduce((sum, s) => sum + s.duration, 0);
      if (data.lastJoin && data.lastJoin >= cutoff) ms += Date.now() - data.lastJoin;
      const score = calcScore(db, key);
      lines.push({ key, ms, tickets: data.tickets || 0, score });
    }
    lines.sort((a, b) => b.score - a.score);
    const embed = new EmbedBuilder()
      .setTitle(`📊 التقرير ${label}`)
      .setColor(0xFEE75C)
      .setDescription(lines.length === 0 ? 'ما في بيانات' : lines.map((l, i) => `**${i + 1}.** **${l.key}** — ${scoreBar(l.score)}\n⏱️ ${formatDuration(l.ms)} | 🎫 ${l.tickets} تكت`).join('\n\n'))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /online
  if (interaction.commandName === 'online') {
    const online = Object.entries(db.admins)
      .filter(([, data]) => data.lastJoin)
      .map(([key, data]) => `🟢 **${key}** (${data.minecraftName}) — دخل <t:${Math.floor(data.lastJoin / 1000)}:R>`);
    const embed = new EmbedBuilder()
      .setTitle('👥 الأدمن أونلاين الحين')
      .setColor(0x57F287)
      .setDescription(online.length > 0 ? online.join('\n') : 'ما في أحد أونلاين الحين')
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // /alert
  if (interaction.commandName === 'alert') {
    const discord = interaction.options.getString('discord');
    const hours = interaction.options.getInteger('hours');
    const key = getAdminByDiscord(db, discord);
    if (!key) return interaction.reply({ content: `❌ ما في أدمن باسم **${discord}**`, ephemeral: true });
    if (!db.alerts) db.alerts = {};
    db.alerts[key] = { hours, channelId: interaction.channelId };
    saveDB(db);
    return interaction.reply({ content: `✅ راح أنبهك لو **${key}** ما دخل خلال **${hours} ساعة**`, ephemeral: true });
  }
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
      } catch (e) {
        console.error('Alert error:', e);
      }
    }
  }
}

client.login(TOKEN);
