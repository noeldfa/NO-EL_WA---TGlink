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

/* ================== STATE ================== */

const bot = new Telegraf(BOT_TOKEN);
const app = express();

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

/* ================== EXPRESS ================== */

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Bot is running');
});

/* ✅ TELEGRAM WEBHOOK ROUTE */
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200);
});

/* ================== START ================== */

(async () => {
    try {
        console.log("Starting bot...");

        await ensureDirs();
        await loadData();

        app.listen(PORT, () => {
            console.log(`HTTP Server running on port ${PORT}`);
        });

        console.log("Webhook mode ready");

    } catch (err) {
        console.error("STARTUP ERROR:", err);
    }
})();
