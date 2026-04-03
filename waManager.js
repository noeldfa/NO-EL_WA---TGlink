
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const fs = require('fs/promises');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');

/* ================= CONFIG ================= */

const PROXY_FILE = './proxies.txt';
const SESS_PATH = './database/sessions';

/* ================= STATE ================= */

let bot, activeSockets, assignments, messagingState;

/* ================= INIT ================= */

function init(ctx) {
    bot = ctx.bot;
    activeSockets = ctx.activeSockets;
    assignments = ctx.assignments;
    messagingState = ctx.messagingState;
}

/* ================= PROXY ================= */

async function getProxy() {
    try {
        const data = await fs.readFile(PROXY_FILE, 'utf-8');

        const list = data
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && l.startsWith('socks'));

        if (!list.length) return null;

        return list[Math.floor(Math.random() * list.length)];
    } catch {
        return null;
    }
}

/* ================= START ================= */

async function start(chatId, number, isRestart = false) {
    const clean = number.replace(/[^0-9]/g, '');
    const sessionKey = `${chatId}_${clean}`;
    const sessionDir = path.join(SESS_PATH, sessionKey);

    if (activeSockets.has(sessionKey) && !isRestart) return;

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    /* ===== PROXY ===== */

    let proxy = await getProxy();
    let agent;

    try {
        agent = proxy ? new SocksProxyAgent(proxy) : undefined;
    } catch {
        agent = undefined;
        proxy = null;
    }

    /* ===== SOCKET ===== */

    const sock = makeWASocket({
        version,
        auth: state,
        agent,
        fetchAgent: agent,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000
    });

    activeSockets.set(sessionKey, sock);

    sock.ev.on('creds.update', saveCreds);

    /* ===== PAIRING ===== */

    if (!sock.authState.creds.registered && !isRestart) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(clean);

                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

                await bot.telegram.sendMessage(
                    chatId,
                    `🔑 *PAIRING CODE*\n\nNumber: \`${clean}\`\nCode: \`${formatted}\``,
                    { parse_mode: 'Markdown' }
                );

            } catch (err) {
                await bot.telegram.sendMessage(
                    chatId,
                    `❌ Pairing failed: ${err.message}`
                );
            }
        }, 5000);
    }

    /* ================= EVENTS ================= */

    const groups = require('./groups');
    const inbox = require('./inbox');
    const statuses = require('./statuses');

    /* ===== MESSAGES ===== */
    sock.ev.on('messages.upsert', async (m) => {
        if (!assignments.has(sessionKey)) return;
        if (!messagingState.get(sessionKey)) return;

        await groups.onMessage({
            sock,
            sessionKey,
            messages: m.messages
        });

        await inbox.onMessage({
            sock,
            sessionKey,
            messages: m.messages
        });

        await statuses.onMessage({
            sock,
            sessionKey,
            messages: m.messages
        });
    });

    /* ===== GROUP EVENTS ===== */
    sock.ev.on('group-participants.update', async (data) => {
        if (!assignments.has(sessionKey)) return;

        if (groups.onGroupEvent) {
            await groups.onGroupEvent({
                sock,
                sessionKey,
                data
            });
        }
    });

    /* ===== REACTIONS ===== */
    sock.ev.on('messages.reaction', async (data) => {
        if (!assignments.has(sessionKey)) return;

        if (groups.onReaction) {
            await groups.onReaction({
                sock,
                sessionKey,
                data
            });
        }
    });

    /* ===== CONNECTION ===== */
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {

        if (connection === 'open') {
            const mode = proxy ? 'PROXY' : 'DIRECT';

            await bot.telegram.sendMessage(
                chatId,
                `✅ ${clean} connected [${mode}]`
            );
        }

        if (connection === 'close') {
            activeSockets.delete(sessionKey);

            const code = lastDisconnect?.error?.output?.statusCode;

            /* ===== LOGGED OUT ===== */
            if (code === DisconnectReason.loggedOut) {
                try {
                    await fs.rm(sessionDir, { recursive: true, force: true });

                    await bot.telegram.sendMessage(
                        chatId,
                        `🧹 Session deleted for ${clean} (logged out)`
                    );
                } catch {}

                return;
            }

            /* ===== AUTO RECONNECT ===== */
            if (messagingState.get(sessionKey) !== false) {
                setTimeout(() => {
                    start(chatId, clean, true);
                }, 5000);
            }
        }
    });
}

/* ================= EXPORT ================= */

module.exports = {
    init,
    start
};
