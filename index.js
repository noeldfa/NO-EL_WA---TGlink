require('dotenv').config();

const { Telegraf } = require('telegraf');
const express = require('express');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

const PORT = process.env.PORT || 3000;
const DOMAIN = "https://no-elwa-tglink-production.up.railway.app";
const WEBHOOK_PATH = `/bot${process.env.BOT_TOKEN}`;

app.use(express.json());

/* ================== FORCE TELEGRAM → TELEGRAF ================== */

app.post(WEBHOOK_PATH, async (req, res) => {
    try {
        console.log("🔥 WEBHOOK HIT");

        await bot.handleUpdate(req.body);

        console.log("✅ UPDATE PROCESSED");

        res.sendStatus(200);
    } catch (err) {
        console.error("❌ UPDATE ERROR:", err);
        res.sendStatus(500);
    }
});

/* ================== HARD DEBUG ================== */

bot.use(async (ctx, next) => {
    console.log("👉 UPDATE TYPE:", ctx.updateType);

    if (ctx.message) {
        console.log("📩 TEXT:", ctx.message.text);
    }

    return next();
});

/* ================== GUARANTEED RESPONSE ================== */

bot.hears(/.*/, (ctx) => {
    console.log("💬 FALLBACK TRIGGERED");
    ctx.reply("✅ BOT IS RESPONDING");
});

/* ================== START ================== */

(async () => {
    try {
        await bot.telegram.deleteWebhook(); // 🔥 CLEAR OLD BUGS

        await bot.telegram.setWebhook(DOMAIN + WEBHOOK_PATH);

        console.log("🌐 Webhook set:", DOMAIN + WEBHOOK_PATH);

        app.listen(PORT, () => {
            console.log("🚀 Server running on port", PORT);
        });

    } catch (err) {
        console.error("START ERROR:", err);
    }
})();
