
const fs = require('fs/promises');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let bot, assignments, messagingState;

const DB_PATH = './database';
const TOPIC_FILE = path.join(DB_PATH, 'topics.json');
const MSG_MAP_FILE = path.join(DB_PATH, 'msgmap.json');

let topics = {};
let msgMap = {};

/* ================= INIT ================= */

async function load() {
    try { topics = JSON.parse(await fs.readFile(TOPIC_FILE)); } catch {}
    try { msgMap = JSON.parse(await fs.readFile(MSG_MAP_FILE)); } catch {}
}

async function saveTopics() {
    await fs.writeFile(TOPIC_FILE, JSON.stringify(topics, null, 2));
}

async function saveMsgMap() {
    await fs.writeFile(MSG_MAP_FILE, JSON.stringify(msgMap, null, 2));
}

function init(ctx) {
    bot = ctx.bot;
    assignments = ctx.assignments;
    messagingState = ctx.messagingState;
    load();

    /* ===== TG → WA ===== */
    bot.on('message', async (ctx) => {
        if (!ctx.chat?.is_forum) return;

        const threadId = ctx.message.message_thread_id;
        const groupId = ctx.chat.id;

        const topicEntry = Object.entries(topics)
            .find(([_, v]) => v.threadId === threadId);

        if (!topicEntry) return;

        const [groupJid] = topicEntry;

        const sessionKey = [...assignments.entries()]
            .find(([_, gid]) => gid === groupId)?.[0];

        if (!sessionKey) return;

        const sock = global.activeSockets.get(sessionKey);
        if (!sock) return;

        await handleTGToWA(sock, ctx, groupJid);
    });
}

/* ================= HELPERS ================= */

function jidToNumber(jid) {
    return jid?.split('@')[0];
}

async function getOrCreateTopic(groupId, groupJid, name) {
    if (topics[groupJid]) return topics[groupJid].threadId;

    const res = await bot.telegram.createForumTopic(groupId, name);

    topics[groupJid] = {
        threadId: res.message_thread_id,
        name
    };

    await saveTopics();
    return res.message_thread_id;
}

async function downloadMedia(msg, type) {
    const stream = await downloadContentFromMessage(msg, type);
    let buffer = Buffer.from([]);

    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

/* ===== 🧠 MENTION PARSER ===== */
function parseMentions(text = "") {
    const regex = /@(\d{6,15})/g;
    const mentions = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
        mentions.push(`${match[1]}@s.whatsapp.net`);
    }

    return mentions;
}

/* ================= WA → TG ================= */

async function onMessage({ sock, sessionKey, messages }) {
    const groupId = assignments.get(sessionKey);

    for (const msg of messages) {
        if (!msg.key.remoteJid.endsWith('@g.us')) continue;

        const groupJid = msg.key.remoteJid;
        const sender = jidToNumber(msg.key.participant || msg.key.remoteJid);
        const name = msg.pushName || "Unknown";

        const meta = await sock.groupMetadata(groupJid);
        const threadId = await getOrCreateTopic(groupId, groupJid, meta.subject);

        const replyId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        const replyTo = replyId && msgMap[replyId]?.tgMsgId;

        let content = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text;

        /* ===== POLL ===== */
        if (msg.message?.pollCreationMessage) {
            const poll = msg.message.pollCreationMessage;

            const tgMsg = await bot.telegram.sendPoll(
                groupId,
                poll.name,
                poll.options.map(o => o.optionName),
                { message_thread_id: threadId }
            );

            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
            continue;
        }

        /* ===== TEXT ===== */
        if (content) {
            const tgMsg = await bot.telegram.sendMessage(
                groupId,
                `Number: ${sender}\nMoniker: ${name}\nText: ${content}`,
                {
                    message_thread_id: threadId,
                    reply_to_message_id: replyTo
                }
            );

            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
            continue;
        }

        /* ===== MEDIA ===== */

        const m = msg.message;

        if (m.imageMessage) {
            const buffer = await downloadMedia(m.imageMessage, 'image');
            const tgMsg = await bot.telegram.sendPhoto(groupId, { source: buffer }, {
                caption: `Number: ${sender}`,
                message_thread_id: threadId,
                reply_to_message_id: replyTo
            });
            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
        }

        else if (m.videoMessage) {
            const buffer = await downloadMedia(m.videoMessage, 'video');
            const tgMsg = await bot.telegram.sendVideo(groupId, { source: buffer }, {
                caption: `Number: ${sender}`,
                message_thread_id: threadId,
                reply_to_message_id: replyTo
            });
            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
        }

        else if (m.audioMessage) {
            const buffer = await downloadMedia(m.audioMessage, 'audio');

            const tgMsg = m.audioMessage.ptt
                ? await bot.telegram.sendVoice(groupId, { source: buffer }, { message_thread_id: threadId })
                : await bot.telegram.sendAudio(groupId, { source: buffer }, { message_thread_id: threadId });

            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
        }

        else if (m.stickerMessage) {
            const buffer = await downloadMedia(m.stickerMessage, 'sticker');
            const tgMsg = await bot.telegram.sendSticker(groupId, { source: buffer }, {
                message_thread_id: threadId
            });
            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
        }

        else if (m.documentMessage) {
            const buffer = await downloadMedia(m.documentMessage, 'document');
            const tgMsg = await bot.telegram.sendDocument(groupId, { source: buffer }, {
                message_thread_id: threadId
            });
            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id, chatId: groupJid };
        }
    }
}

/* ================= TG → WA ================= */

async function handleTGToWA(sock, ctx, groupJid) {
    const msg = ctx.message;

    let quoted;
    if (msg.reply_to_message) {
        const found = Object.entries(msgMap)
            .find(([_, v]) => v.tgMsgId === msg.reply_to_message.message_id);
        if (found) quoted = found[0];
    }

    /* ===== TEXT + MENTIONS ===== */
    if (msg.text) {
        const mentions = parseMentions(msg.text);

        await sock.sendMessage(groupJid, {
            text: msg.text,
            mentions
        });
    }

    /* ===== PHOTO ===== */
    if (msg.photo) {
        const file = await ctx.telegram.getFile(msg.photo.pop().file_id);
        const mentions = parseMentions(msg.caption || "");

        await sock.sendMessage(groupJid, {
            image: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` },
            caption: msg.caption || "",
            mentions
        });
    }

    /* ===== VIDEO ===== */
    if (msg.video) {
        const file = await ctx.telegram.getFile(msg.video.file_id);
        const mentions = parseMentions(msg.caption || "");

        await sock.sendMessage(groupJid, {
            video: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` },
            caption: msg.caption || "",
            mentions
        });
    }

    /* ===== AUDIO ===== */
    if (msg.voice) {
        const file = await ctx.telegram.getFile(msg.voice.file_id);

        await sock.sendMessage(groupJid, {
            audio: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` },
            ptt: true
        });
    }

    /* ===== STICKER ===== */
    if (msg.sticker) {
        const file = await ctx.telegram.getFile(msg.sticker.file_id);

        await sock.sendMessage(groupJid, {
            sticker: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` }
        });
    }

    /* ===== POLL ===== */
    if (msg.poll) {
        await sock.sendMessage(groupJid, {
            poll: {
                name: msg.poll.question,
                values: msg.poll.options.map(o => o.text)
            }
        });
    }
}

/* ================= EXPORT ================= */

module.exports = {
    init,
    onMessage
};