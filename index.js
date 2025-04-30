const { default: makeWASocket, useSingleFileAuthState } = require('@whiskeysockets/baileys')
const fs = require('fs')
const P = require('pino')
const ytdl = require('ytdl-core')
const TikTokScraper = require('tiktok-scraper')
const { exec } = require('child_process')
const quotes = require('./lib/quotes.json')
const gameData = require('./lib/game.json')
const config = require('./config')

const { state, saveState } = useSingleFileAuthState('./session/auth.json')
const conn = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: true,
    auth: state
})

conn.ev.on('creds.update', saveState)

const prefix = '.'
let isPublic = true
let scores = {}

conn.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages[0]?.message) return
    const msg = messages[0]
    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const sender = isGroup ? msg.key.participant : msg.key.remoteJid
    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    const command = body.startsWith(prefix) ? body.slice(1).split(' ')[0] : ''
    const args = body.split(' ').slice(1)

    if (!isPublic && sender !== config.owner && command) return

    if (command === 'menu' || command === 'help') {
        const menu = `
🔥 0xGolip-Team WhatsApp Bot
Commands:
1. .tebak [id/en] - Tebak gambar
2. .quotes - Quotes random
3. .menu / .help - Menu CLI
4. .mp3 <link> - Convert YT ke MP3
5. Kirim gambar/video - Auto stiker
6. Send TikTok/YT link - Auto download
7. .bc <text> - Broadcast (Owner only)
        `
        await conn.sendMessage(from, { text: menu }, { quoted: msg })
    }

    else if (command === 'quotes') {
        const lang = args[0] === 'en' ? 'en' : 'id'
        const q = quotes[lang][Math.floor(Math.random() * quotes[lang].length)]
        await conn.sendMessage(from, { text: `_"${q}"_` }, { quoted: msg })
    }

    else if (command === 'tebak') {
        const lang = args[0] === 'en' ? 'en' : 'id'
        const data = gameData[Math.floor(Math.random() * gameData.length)]
        const image = fs.readFileSync(data.image)
        const answer = lang === 'en' ? data.answer_en : data.answer_id
        await conn.sendMessage(from, { image, caption: 'Tebak gambar ini!' }, { quoted: msg })
        scores[sender] = { answer, points: scores[sender]?.points || 0 }
    }

    else if (scores[sender] && body.toLowerCase() === scores[sender].answer.toLowerCase()) {
        scores[sender].points += 1
        await conn.sendMessage(from, { text: `✅ Benar! Poin: ${scores[sender].points}` }, { quoted: msg })
        delete scores[sender].answer
    }

    else if (ytdl.validateURL(body)) {
        await conn.sendMessage(from, { text: '⬇️ Downloading video...' }, { quoted: msg })
        const stream = ytdl(body, { quality: '18' })
        const path = './media/video.mp4'
        const file = fs.createWriteStream(path)
        stream.pipe(file)
        stream.on('end', async () => {
            const vid = fs.readFileSync(path)
            await conn.sendMessage(from, { video: vid }, { quoted: msg })
            fs.unlinkSync(path)
        })
    }

    else if (body.startsWith('.mp3') && ytdl.validateURL(args[0])) {
        await conn.sendMessage(from, { text: '🎧 Converting...' }, { quoted: msg })
        const url = args[0]
        const path = './media/audio.mp3'
        exec(`yt-dlp -x --audio-format mp3 -o "${path}" "${url}"`, async (err) => {
            if (!err && fs.existsSync(path)) {
                const audio = fs.readFileSync(path)
                await conn.sendMessage(from, { audio, mimetype: 'audio/mp4' }, { quoted: msg })
                fs.unlinkSync(path)
            } else {
                await conn.sendMessage(from, { text: '❌ Gagal convert.' }, { quoted: msg })
            }
        })
    }

    else if (command === 'bc' && sender === config.owner) {
        const chats = await conn.groupFetchAllParticipating()
        for (let jid in chats) {
            await conn.sendMessage(jid, { text: args.join(' ') })
        }
    }

    const mimetype = msg.message?.imageMessage?.mimetype || msg.message?.videoMessage?.mimetype
    if (msg.message.imageMessage || msg.message.videoMessage) {
        const buffer = await conn.downloadMediaMessage(msg)
        await conn.sendMessage(from, { sticker: buffer }, { quoted: msg })
    }
})

conn.ev.on('group-participants.update', async (update) => {
    if (update.action === 'add') {
        const name = update.participants[0].split('@')[0]
        await conn.sendMessage(update.id, { text: `👋 Welcome @${name} to 0xGolip-Team`, mentions: update.participants })
    }
})
