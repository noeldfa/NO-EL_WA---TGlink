
const fs = require('fs/promises');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let bot, assignments, messagingState;

const DB_PATH = './database';
const MSG_MAP_FILE = path.join(DB_PATH, 'status_msgmap.json');

let msgMap = {};
let statusTopic = {}; // per session

/* ================= INIT ================= */

async function load() {
    try { msgMap = JSON.parse(await fs.readFile(MSG_MAP_FILE)); } catch {}
}

async function saveMsgMap() {
    await fs.writeFile(MSG_MAP_FILE, JSON.stringify(msgMap, null, 2));
}

function init(ctx) {
    bot = ctx.bot;
    assignments = ctx.assignments;
    messagingState = ctx.messagingState;
    load();

    /* ===== TG → WA (Replies + Reactions) ===== */
    bot.on('message', async (ctx) => {
        if (!ctx.chat?.is_forum) return;

        const threadId = ctx.message.message_thread_id;
        const groupId = ctx.chat.id;

        const sessionKey = [...assignments.entries()]
            .find(([_, gid]) => gid === groupId)?.[0];

        if (!sessionKey) return;

        if (statusTopic[sessionKey] !== threadId) return;

        const sock = global.activeSockets.get(sessionKey);
        if (!sock) return;

        const msg = ctx.message;

        if (!msg.reply_to_message) return;

        const found = Object.entries(msgMap)
            .find(([_, v]) => v.tgMsgId === msg.reply_to_message.message_id);

        if (!found) return;

        const [statusId, data] = found;

        /* ===== TEXT REPLY ===== */
        if (msg.text) {
            await sock.sendMessage(data.jid, {
                text: msg.text
            }, {
                quoted: {
                    key: {
                        remoteJid: data.jid,
                        id: statusId
                    }
                }
            });
        }

        /* ===== STICKER REPLY ===== */
        if (msg.sticker) {
            const file = await ctx.telegram.getFile(msg.sticker.file_id);

            await sock.sendMessage(data.jid, {
                sticker: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` }
            }, {
                quoted: {
                    key: {
                        remoteJid: data.jid,
                        id: statusId
                    }
                }
            });
        }
    });

    /* ===== TG REACTIONS ===== */
    bot.on('message_reaction', async (ctx) => {
        const reaction = ctx.update.message_reaction;

        const msgId = reaction.message_id;
        const emoji = reaction.new_reaction?.[0]?.emoji;

        if (!emoji) return;

        const found = Object.entries(msgMap)
            .find(([_, v]) => v.tgMsgId === msgId);

        if (!found) return;

        const [statusId, data] = found;

        const sock = global.activeSockets.get(data.sessionKey);
        if (!sock) return;

        await sock.sendMessage(data.jid, {
            react: {
                text: emoji,
                key: {
                    remoteJid: data.jid,
                    id: statusId
                }
            }
        });
    });
}

/* ================= HELPERS ================= */

function jidToNumber(jid) {
    return jid.split('@')[0];
}

async function getStatusTopic(groupId, sessionKey) {
    if (statusTopic[sessionKey]) return statusTopic[sessionKey];

    const res = await bot.telegram.createForumTopic(groupId, "Statuses");

    statusTopic[sessionKey] = res.message_thread_id;
    return statusTopic[sessionKey];
}

async function downloadMedia(msg, type) {
    const stream = await downloadContentFromMessage(msg, type);
    let buffer = Buffer.from([]);

    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

/* ================= WA → TG ================= */

async function onMessage({ sock, sessionKey, messages }) {
    const groupId = assignments.get(sessionKey);

    for (const msg of messages) {
        const jid = msg.key.remoteJid;

        if (jid !== 'status@broadcast') continue;

        const senderJid = msg.key.participant;
        const number = jidToNumber(senderJid);

        const threadId = await getStatusTopic(groupId, sessionKey);

        const captionBase = `Number: ${number}`;

        const m = msg.message;

        let tgMsg;

        /* ===== TEXT STATUS ===== */
        if (m?.conversation) {
            tgMsg = await bot.telegram.sendMessage(
                groupId,
                `${captionBase}\nText: ${m.conversation}`,
                { message_thread_id: threadId }
            );
        }

        /* ===== IMAGE ===== */
        else if (m?.imageMessage) {
            const buffer = await downloadMedia(m.imageMessage, 'image');

            tgMsg = await bot.telegram.sendPhoto(groupId, { source: buffer }, {
                caption: `${captionBase}\n${m.imageMessage.caption || ""}`,
                message_thread_id: threadId
            });
        }

        /* ===== VIDEO ===== */
        else if (m?.videoMessage) {
            const buffer = await downloadMedia(m.videoMessage, 'video');

            tgMsg = await bot.telegram.sendVideo(groupId, { source: buffer }, {
                caption: `${captionBase}\n${m.videoMessage.caption || ""}`,
                message_thread_id: threadId
            });
        }

        /* ===== AUDIO ===== */
        else if (m?.audioMessage) {
            const buffer = await downloadMedia(m.audioMessage, 'audio');

            tgMsg = await bot.telegram.sendVoice(groupId, { source: buffer }, {
                message_thread_id: threadId
            });
        }

        if (tgMsg) {
            msgMap[msg.key.id] = {
                tgMsgId: tgMsg.message_id,
                jid: senderJid,
                sessionKey
            };

            await saveMsgMap();
        }
    }
}

/* ================= EXPORT ================= */

module.exports = {
    init,
    onMessage
};