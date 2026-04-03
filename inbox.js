
const fs = require('fs/promises');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

let bot, assignments, messagingState;

const DB_PATH = './database';
const TOPIC_FILE = path.join(DB_PATH, 'inbox_topics.json');
const MSG_MAP_FILE = path.join(DB_PATH, 'inbox_msgmap.json');

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

        const [userJid] = topicEntry;

        const sessionKey = [...assignments.entries()]
            .find(([_, gid]) => gid === groupId)?.[0];

        if (!sessionKey) return;

        const sock = global.activeSockets.get(sessionKey);
        if (!sock) return;

        await handleTGToWA(sock, ctx, userJid);
    });
}

/* ================= HELPERS ================= */

function jidToNumber(jid) {
    return jid.split('@')[0];
}

async function getOrCreateTopic(groupId, userJid, name) {
    if (topics[userJid]) return topics[userJid].threadId;

    const number = jidToNumber(userJid);
    const title = `${number}${name ? ` (${name})` : ''}`;

    const res = await bot.telegram.createForumTopic(groupId, title);

    topics[userJid] = {
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
        const jid = msg.key.remoteJid;

        if (jid.endsWith('@g.us')) continue; // ignore groups

        const sender = jidToNumber(jid);
        const name = msg.pushName || "";

        const threadId = await getOrCreateTopic(groupId, jid, name);

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

            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id };
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

            msgMap[msg.key.id] = { tgMsgId: tgMsg.message_id };
            continue;
        }

        /* ===== MEDIA ===== */

        const m = msg.message;

        if (m.imageMessage) {
            const buffer = await downloadMedia(m.imageMessage, 'image');
            await bot.telegram.sendPhoto(groupId, { source: buffer }, { message_thread_id: threadId });
        }

        else if (m.videoMessage) {
            const buffer = await downloadMedia(m.videoMessage, 'video');
            await bot.telegram.sendVideo(groupId, { source: buffer }, { message_thread_id: threadId });
        }

        else if (m.audioMessage) {
            const buffer = await downloadMedia(m.audioMessage, 'audio');

            if (m.audioMessage.ptt) {
                await bot.telegram.sendVoice(groupId, { source: buffer }, { message_thread_id: threadId });
            } else {
                await bot.telegram.sendAudio(groupId, { source: buffer }, { message_thread_id: threadId });
            }
        }

        else if (m.stickerMessage) {
            const buffer = await downloadMedia(m.stickerMessage, 'sticker');
            await bot.telegram.sendSticker(groupId, { source: buffer }, { message_thread_id: threadId });
        }
    }
}

/* ================= TG → WA ================= */

async function handleTGToWA(sock, ctx, userJid) {
    const msg = ctx.message;

    if (msg.text) {
        const mentions = parseMentions(msg.text);

        await sock.sendMessage(userJid, {
            text: msg.text,
            mentions
        });
    }

    if (msg.photo) {
        const file = await ctx.telegram.getFile(msg.photo.pop().file_id);

        await sock.sendMessage(userJid, {
            image: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` }
        });
    }

    if (msg.video) {
        const file = await ctx.telegram.getFile(msg.video.file_id);

        await sock.sendMessage(userJid, {
            video: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` }
        });
    }

    if (msg.voice) {
        const file = await ctx.telegram.getFile(msg.voice.file_id);

        await sock.sendMessage(userJid, {
            audio: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` },
            ptt: true
        });
    }

    if (msg.sticker) {
        const file = await ctx.telegram.getFile(msg.sticker.file_id);

        await sock.sendMessage(userJid, {
            sticker: { url: `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` }
        });
    }

    if (msg.poll) {
        await sock.sendMessage(userJid, {
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