function init(ctx) {
    const {
        bot,
        waManager,
        assignments,
        messagingState,
        premiumUsers,
        saveAssignments,
        savePremium
    } = ctx;

    const OWNER_ID = Number(process.env.OWNER_ID);

    console.log("✅ Commands module loaded");

    function sessionKey(chatId, number) {
        return `${chatId}_${number}`;
    }

    /* ================== BASIC ================== */

    bot.start((ctx) => {
    console.log("START COMMAND HIT");
    ctx.reply("Bot is alive ✅");
});

    /* ================== PAIR ================== */

    bot.command('pair', (ctx) => {
        const n = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');

        if (!n) {
            return ctx.reply("Usage: /pair 233XXXXXXXXX");
        }

        ctx.reply("⏳ Initializing WhatsApp...");

        setTimeout(() => {
            try {
                waManager.start(ctx.chat.id, n); // ✅ FIXED
            } catch (err) {
                console.error("PAIR ERROR:", err);
                ctx.reply("❌ Failed to start WhatsApp session");
            }
        }, 1000);
    });

    /* ================== ASSIGN ================== */

    bot.command('assign', async (ctx) => {
        const [_, groupId, number] = ctx.message.text.split(' ');
        const key = sessionKey(ctx.chat.id, number);

        if (!groupId || !number) {
            return ctx.reply("Usage: /assign <groupId> <number>");
        }

        assignments.set(key, Number(groupId));
        messagingState.set(key, true);

        await saveAssignments();

        ctx.reply("✅ Assigned");
    });

    /* ================== MESSAGING ================== */

    bot.command('messaging', async (ctx) => {
        const [_, number, state] = ctx.message.text.split(' ');
        const key = sessionKey(ctx.chat.id, number);

        if (!number || !state) {
            return ctx.reply("Usage: /messaging <number> <on/off>");
        }

        messagingState.set(key, state === 'on');
        await saveAssignments();

        ctx.reply(`Messaging ${state}`);
    });

    /* ================== PREMIUM ================== */

    bot.command('addprem', async (ctx) => {
        if (ctx.from.id !== OWNER_ID) return;

        const id = Number(ctx.message.text.split(' ')[1]);
        if (!id) return ctx.reply("Usage: /addprem <userId>");

        premiumUsers.add(id);

        await savePremium();
        ctx.reply("✅ Added premium");
    });

    bot.command('delprem', async (ctx) => {
        if (ctx.from.id !== OWNER_ID) return;

        const id = Number(ctx.message.text.split(' ')[1]);
        if (!id) return ctx.reply("Usage: /delprem <userId>");

        premiumUsers.delete(id);

        await savePremium();
        ctx.reply("❌ Removed premium");
    });

    bot.command('prem', (ctx) => {
        ctx.reply(
            premiumUsers.has(ctx.from.id)
                ? "✅ Premium"
                : "❌ Free"
        );
    });

    /* ================== DEBUG ================== */

    bot.on('message', (ctx) => {
        console.log("📩 MESSAGE:", ctx.message?.text);
    });
}

module.exports = { init };
