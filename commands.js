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

    function sessionKey(chatId, number) {
        return `${chatId}_${number}`;
    }

    bot.start(ctx => ctx.reply("🤖 Ready"));

    bot.command('pair', (ctx) => {
    const n = ctx.message.text.split(' ')[1]?.replace(/[^0-9]/g, '');

    if (!n) {
        return ctx.reply("Usage: /pair 233XXXXXXXXX");
    }

    ctx.reply("⏳ Initializing WhatsApp...");

    setTimeout(() => {
        startWhatsApp(ctx.chat.id, n);
    }, 1000);
});

    bot.command('assign', async (ctx) => {
        const [_, groupId, number] = ctx.message.text.split(' ');
        const key = sessionKey(ctx.chat.id, number);

        assignments.set(key, Number(groupId));
        messagingState.set(key, true);

        await saveAssignments();

        ctx.reply("✅ Assigned");
    });

    bot.command('messaging', async (ctx) => {
        const [_, number, state] = ctx.message.text.split(' ');
        const key = sessionKey(ctx.chat.id, number);

        messagingState.set(key, state === 'on');
        await saveAssignments();

        ctx.reply(`Messaging ${state}`);
    });

    /* ===== PREMIUM ===== */

    bot.command('addprem', async (ctx) => {
        if (ctx.from.id !== OWNER_ID) return;

        const id = Number(ctx.message.text.split(' ')[1]);
        premiumUsers.add(id);

        await savePremium();
        ctx.reply("✅ Added premium");
    });

    bot.command('delprem', async (ctx) => {
        if (ctx.from.id !== OWNER_ID) return;

        const id = Number(ctx.message.text.split(' ')[1]);
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
}

module.exports = { init };