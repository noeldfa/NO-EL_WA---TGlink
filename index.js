console.log("FILE STARTED");

require('dotenv').config();

const { Telegraf, session } = require('telegraf');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');

/* ================== ENV ================== */

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");

/* ================== BOT ================== */

const bot = new Telegraf(BOT_TOKEN);

/* ✅ Middleware FIRST */
bot.use(session());

/* 🔥 DEBUG: confirm updates enter Telegraf */
bot.use((ctx, next) => {
    console.log("👉 UPDATE TYPE:", ctx.updateType);
    return next();
});

/* 🔥 FALLBACK TEST (VERY IMPORTANT) */
bot.on('text', (ctx, next) => {
    console.log("📩 TEXT RECEIVED:", ctx.message.text);
    return next();
});

/* ================== EXPRESS ================== */

const app = express();
app.use(express.json());

/* ================== STATE ================== */

const activeSockets = new Map();
global.activeSockets = activeSockets;

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
const commands = require('./commands');
const groups = require('./groups');
const inbox = require('./inbox');
const statuses = require('./statuses');

/* ================== INIT MODULES ================== */

waManager.init({ bot, activeSockets, assignments, messagingState });

groups.init({ bot, assignments, messagingState });
inbox.init({ bot, assignments, messagingState });
statuses.init({ bot, assignments, messagingState });

console.log("Commands init starting...");

commands.init({
    bot,
    waManager,
    assignments,
    messagingState,
    premiumUsers,
    OWNER_ID,

    saveAssignments: () => saveJSON(
        ASSIGN_FILE,
        Object.fromEntries(
            [...assignments.entries()].map(([k, v]) => [k, {
                groupId: v,
                enabled: messagingState.get(k)
            }])
        )
    ),

    savePremium: () => saveJSON(PREM_FILE, [...premiumUsers])
});

console.log("Commands init finished");

/* ================== RESTORE SESSIONS ================== */

async function restoreSessions() {
    try {
        const dirs = await fs.readdir(SESS_PATH);

        for (const dir of dirs) {
            if (!dir.includes('_')) continue;

            const [chatId, number] = dir.split('_');

            setTimeout(() => {
                waManager.start(Number(chatId), number, true);
            }, 2000);
        }
    } catch (err) {
        console.error("Restore error:", err.message);
    }
}

/* ================== WEBHOOK ================== */

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;
const WEBHOOK_URL = `https://no-elwa-tglink-production.up.railway.app${WEBHOOK_PATH}`;

app.post(WEBHOOK_PATH, async (req, res) => {
    console.log("🔥 WEBHOOK HIT");

    try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (err) {
        console.error("Webhook error:", err);
        res.sendStatus(500);
    }
});

app.get('/', (req, res) => {
    res.send('Bot is running');
});

/* ================== START ================== */

(async () => {
    try {
        console.log("Starting bot...");

        await ensureDirs();
        await loadData();
        await restoreSessions();

        app.listen(PORT, async () => {
            console.log(`HTTP Server running on port ${PORT}`);

            try {
                await bot.telegram.setWebhook(WEBHOOK_URL, {
                    drop_pending_updates: true
                });

                console.log("🌐 Webhook set:", WEBHOOK_URL);
            } catch (err) {
                console.error("Webhook setup error:", err);
            }
        });

    } catch (err) {
        console.error("STARTUP ERROR:", err);
    }
})();
