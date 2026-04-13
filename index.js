const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ============================== CONFIG (إعدادات البيئة) ==============================
// ملاحظة: لا تضع التوكن هنا، ضعه في إعدادات Railway باسم DISCORD_TOKEN
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = '1491018433620611224';
const LOG_CHANNEL_ID = '1456113452798971935';
const TICKET_CHANNEL_ID = '1430332532557222008';
const DB_FILE = './data.json';
// =====================================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// وظائف قاعدة البيانات
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        return { tickets: [] };
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4));
}

client.once('ready', () => {
    console.log(`✅ تمت عملية تسجيل الدخول بنجاح باسم: ${client.user.tag}`);
});

// تشغيل البوت
client.login(TOKEN);
