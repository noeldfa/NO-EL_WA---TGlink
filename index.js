console.log("FILE STARTED");

require('dotenv').config();

const { Telegraf } = require('telegraf');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');

/* ================== ENV ================== */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");

/* ================== INIT ================== */

const bot = new Telegraf(BOT_TOKEN);
const app = express();

/* ================== STATE ================== */

const activeSockets = new Map();
const assignments = new Map();
const messagingState = new Map();
const premiumUsers = new Set();

/* ================== PATHS ================== */

const DB_PATH = './database';
const SESS_PATH = path.join(DB_PATH, 'sessions');
const ASSIGN_FILE = path.join(DB_PATH, 'assignments.json');
const PREM_FILE = path.join(DB_PATH, 'premium.json');

/* ================== UTIL ================== */

async function ensureDirs() {
    await fs.mkdir(SESS_PATH, { recursive: true });
}

async function loadJSON(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file));
    } catch {
        return fallback;
    }
}

async function saveJSON(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

/* ================== LOAD DATA ================== */

async function loadData() {
    const assignData = await loadJSON(ASSIGN_FILE, {});

    Object.entries(assignData).forEach(([k, v]) => {
        assignments.set(k, v.groupId);
        messagingState.set(k, v.enabled);
    });

    const premData = await loadJSON(PREM_FILE, []);
    premData.forEach(id => premiumUsers.add(id));
}

/* ================== MODULES ================== */

const waManager = require('./waManager');
const groups = require('./groups');
const inbox = require('./inbox');
const statuses = require('./statuses');

/* ================== COMMANDS (INLINE) ================== */

function sessionKey(chatId, number) {
    return `${chatId}_${number}`;
}

bot.start((ctx) => {
    console.log("START HIT");
    ctx.reply("🤖 Bot is alive");
});

bot.command('pair', (ctx) => {
    const n = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');

    if (!n) return ctx.reply("Usage: /pair 233XXXXXXXXX");

    ctx.reply("⏳ Initializing WhatsApp...");

    setTimeout(() => {
        waManager.start(ctx.chat.id, n);
    }, 1000);
});

bot.command('assign', async (ctx) => {
    const [_, groupId, number] = ctx.message.text.split(' ');
    const key = sessionKey(ctx.chat.id, number);

    if (!groupId || !number)
        return ctx.reply("Usage: /assign <groupId> <number>");

    assignments.set(key, Number(groupId));
    messagingState.set(key, true);

    await saveJSON(ASSIGN_FILE,
        Object.fromEntries([...assignments.entries()].map(([k, v]) => [k, {
            groupId: v,
            enabled: messagingState.get(k)
        }]))
    );

    ctx.reply("✅ Assigned");
});

bot.command('messaging', async (ctx) => {
    const [_, number, state] = ctx.message.text.split(' ');
    const key = sessionKey(ctx.chat.id, number);

    if (!number || !state)
        return ctx.reply("Usage: /messaging <number> <on/off>");

    messagingState.set(key, state === 'on');

    await saveJSON(ASSIGN_FILE,
        Object.fromEntries([...assignments.entries()].map(([k, v]) => [k, {
            groupId: v,
            enabled: messagingState.get(k)
        }]))
    );

    ctx.reply(`Messaging ${state}`);
});

/* ===== PREMIUM ===== */

bot.command('addprem', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;

    const id = Number(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply("Usage: /addprem <userId>");

    premiumUsers.add(id);
    await saveJSON(PREM_FILE, [...premiumUsers]);

    ctx.reply("✅ Added premium");
});

bot.command('delprem', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return;

    const id = Number(ctx.message.text.split(' ')[1]);
    if (!id) return ctx.reply("Usage: /delprem <userId>");

    premiumUsers.delete(id);
    await saveJSON(PREM_FILE, [...premiumUsers]);

    ctx.reply("❌ Removed premium");
});

bot.command('prem', (ctx) => {
    ctx.reply(
        premiumUsers.has(ctx.from.id)
            ? "✅ Premium"
            : "❌ Free"
    );
});

/* ================== INIT MODULES ================== */

waManager.init({
    bot,
    activeSockets,
    assignments,
    messagingState
});

groups.init({ bot, assignments, messagingState });
inbox.init({ bot, assignments, messagingState });
statuses.init({ bot, assignments, messagingState });

/* ================== DEBUG ================== */

bot.on('message', (ctx) => {
    console.log("📩 MESSAGE:", ctx.message?.text);
});

/* ================== WEBHOOK ================== */

const DOMAIN = "https://no-elwa-tglink-production.up.railway.app";

app.use(express.json());

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    console.log("🔥 WEBHOOK HIT");

    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.send('Bot is running');
});

/* ================== START ================== */

(async () => {
    try {
        await ensureDirs();
        await loadData();

        app.listen(PORT, () => {
            console.log(`HTTP Server running on port ${PORT}`);
        });

        await bot.telegram.setWebhook(`${DOMAIN}/bot${BOT_TOKEN}`);
        console.log("🌐 Webhook set");

    } catch (err) {
        console.error("STARTUP ERROR:", err);
    }
})();
