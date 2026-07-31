require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, 
    REST, Routes, SlashCommandBuilder, ChannelType 
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const axios = require('axios');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const port = process.env.PORT || 3000;

// نظام الكول داون للرسائل (في الذاكرة)
const msgCooldowns = new Set();

const neonCSS = `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Roboto:wght@300;400;700&display=swap');
        body { background: #0b0c10; color: #c5c6c7; font-family: 'Roboto', sans-serif; margin: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
        .neon-box { background: #1f2833; padding: 30px; border-radius: 20px; box-shadow: 0 0 20px rgba(0, 245, 212, 0.2); border: 1px solid #45a29e; max-width: 600px; width: 95%; text-align: center; margin: 20px; }
        h1 { font-family: 'Orbitron', sans-serif; color: #66fcf1; text-shadow: 0 0 10px #66fcf1; }
        .btn { display: inline-block; background: transparent; color: #66fcf1; padding: 12px 30px; text-decoration: none; border-radius: 50px; border: 2px solid #66fcf1; transition: 0.4s; margin-top: 20px; cursor: pointer; font-family: 'Orbitron', sans-serif; }
        .btn:hover { background: #66fcf1; color: #0b0c10; box-shadow: 0 0 20px #66fcf1; }
        input, select { width: 100%; padding: 10px; margin-top: 5px; background: #0b0c10; border: 1px solid #45a29e; color: #66fcf1; border-radius: 5px; box-sizing: border-box; }
        label { display: block; margin-top: 15px; text-align: left; color: #66fcf1; font-size: 0.85em; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    </style>
`;

app.get('/', (req, res) => {
    res.send(`<html><head>${neonCSS}</head><body><div class="neon-box"><h1>🪙 COINMASTER PRO</h1><p>نظام النقاط والتفاعل الناري</p><a href="/auth" class="btn">دخول الإدارة 🚀</a></div></body></html>`);
});

app.get('/auth', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('No code provided.');
    try {
        const tRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: process.env.DISCORD_REDIRECT_URI
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const gRes = await axios.get('https://discord.com/api/users/@me/guilds', { headers: { authorization: `Bearer ${tRes.data.access_token}` } });
        const adminGuilds = gRes.data.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n);
        
        let list = '<h1>اختر السيرفر</h1>';
        adminGuilds.forEach(g => { list += `<div style="margin:10px; padding:10px; border:1px solid #45a29e; border-radius:10px;"><a href="/dashboard/${g.id}" style="color:#66fcf1; text-decoration:none;">🔗 ${g.name}</a></div>`; });
        res.send(`<html><head>${neonCSS}</head><body><div class="neon-box">${list}<a href="/" class="btn">رجوع</a></div></body></html>`);
    } catch (e) { res.send('خطأ في الاتصال بديسكورد.'); }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => { if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads'); cb(null, './uploads'); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage });

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

const DB_PATH = path.join(__dirname, 'database.json');
function readDB() { if (!fs.existsSync(DB_PATH)) { const initial = { guilds: {}, users: {} }; fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2)); return initial; } return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function getGuildConfig(guildId) {
    const db = readDB();
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            coinName: 'نقاط', coinEmoji: '🪙', balanceCmd: 'نقاطي', topCmd: 'المتصدرين',
            logChannel: null, topChannel: null, formatType: 'classic', topBanner: null,
            footer: 'CoinMaster Pro', msgGoal: 50, msgReward: 100
        };
        saveDB(db);
    }
    return db.guilds[guildId];
}

function formatPoints(amount, config) {
    const emoji = config.coinEmoji || '';
    switch (config.formatType) {
        case 'neon': return `⚡ ${emoji} ${amount >= 1000 ? (amount / 1000).toFixed(1) + 'K' : amount}`;
        case 'bold': return `**${emoji} ${amount.toLocaleString()}**`;
        default: return `[ ${emoji} ${amount.toLocaleString()} ]`;
    }
}

client.on('ready', async () => {
    console.log(`Bot Ready: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const cmds = [
        new SlashCommandBuilder().setName('give').setDescription('إعطاء نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
        new SlashCommandBuilder().setName('remove').setDescription('سحب نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
        new SlashCommandBuilder().setName('reset').setDescription('تصفير النقاط').addUserOption(o => o.setName('user').setDescription('العضو (اختياري)'))
    ].map(c => c.toJSON());
    client.guilds.cache.forEach(async g => { try { await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, g.id), { body: cmds }); } catch (e) {} });
    setInterval(updateTopChannels, 10 * 60 * 1000);
});

// نظام مكافآت الرسائل + الأوامر النصية
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    const db = readDB();
    const key = `${message.guild.id}_${message.author.id}`;

    // 1. نظام مكافآت الرسائل
    if (!msgCooldowns.has(key)) {
        if (!db.users[key]) db.users[key] = { points: 0, msgCount: 0 };
        if (db.users[key].msgCount === undefined) db.users[key].msgCount = 0;
        
        db.users[key].msgCount++;
        
        if (db.users[key].msgCount >= config.msgGoal) {
            db.users[key].points += config.msgReward;
            db.users[key].msgCount = 0;
            message.channel.send(`🎉 مبروك **${message.author.username}**! حصلت على **${config.msgReward}** ${config.coinName} لتفاعلك المستمر!`).then(m => setTimeout(() => m.delete(), 5000));
        }
        saveDB(db);
        
        msgCooldowns.add(key);
        setTimeout(() => msgCooldowns.delete(key), 3000); // كول داون 3 ثواني
    }

    // 2. الأوامر النصية
    if (message.content === config.balanceCmd) {
        const points = db.users[key]?.points || 0;
        const embed = new EmbedBuilder().setColor('#66fcf1').setTitle(`💰 رصيدك: ${config.coinName}`).setThumbnail(message.author.displayAvatarURL()).setDescription(`رصيدك الحالي هو:\n\n${formatPoints(points, config)}`).setFooter({ text: config.footer });
        message.reply({ embeds: [embed] });
    }
    if (message.content === config.topCmd) {
        const embed = await createTopEmbed(message.guild.id);
        message.reply({ embeds: [embed] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ للمسؤولين فقط.', ephemeral: true });
    const { commandName, options, guildId, user } = interaction;
    const db = readDB();
    const config = getGuildConfig(guildId);
    const target = options.getUser('user');
    const key = target ? `${guildId}_${target.id}` : null;

    if (commandName === 'give' || commandName === 'remove') {
        const amount = options.getInteger('amount');
        if (!db.users[key]) db.users[key] = { points: 0, msgCount: 0 };
        db.users[key].points = commandName === 'give' ? db.users[key].points + amount : Math.max(0, db.users[key].points - amount);
        saveDB(db);
        interaction.reply({ content: `✅ تم التعديل. الرصيد الجديد: ${formatPoints(db.users[key].points, config)}`, ephemeral: true });
        if (config.logChannel) {
            const ch = interaction.guild.channels.cache.get(config.logChannel);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setColor('#66fcf1').setTitle('📢 لوق العمليات').addFields({name:'المسؤول', value:user.username, inline:true}, {name:'العضو', value:target.username, inline:true}, {name:'العملية', value:commandName, inline:true}, {name:'الكمية', value:amount.toString(), inline:true}).setTimestamp()] });
        }
    }
    if (commandName === 'reset') {
        if (target) delete db.users[key]; else Object.keys(db.users).forEach(k => { if (k.startsWith(guildId)) delete db.users[k]; });
        saveDB(db); interaction.reply({ content: '✅ تم التصفير.', ephemeral: true });
    }
});

async function createTopEmbed(guildId) {
    const db = readDB();
    const config = getGuildConfig(guildId);
    const top = Object.entries(db.users).filter(([k]) => k.startsWith(guildId)).map(([k, v]) => ({ id: k.split('_')[1], p: v.points })).sort((a, b) => b.p - a.p).slice(0, 10);
    let desc = '```text\n';
    for (let i = 0; i < top.length; i++) {
        const u = await client.users.fetch(top[i].id).catch(() => ({ username: 'Unknown' }));
        desc += `#${i + 1} | ${config.coinEmoji} ${u.username.padEnd(15)} -> ${top[i].p}\n`;
    }
    desc += '```';
    const embed = new EmbedBuilder().setColor('#66fcf1').setTitle(`🏆 متصدرين ${config.coinName}`).setDescription(desc).setTimestamp().setFooter({ text: config.footer });
    if (config.topBanner) embed.setImage(config.topBanner);
    return embed;
}

async function updateTopChannels() {
    const db = readDB();
    for (const id in db.guilds) {
        const conf = db.guilds[id];
        if (conf.topChannel) {
            const g = client.guilds.cache.get(id);
            const ch = g?.channels.cache.get(conf.topChannel);
            if (ch) {
                const embed = await createTopEmbed(id);
                const msgs = await ch.messages.fetch({ limit: 5 });
                const last = msgs.find(m => m.author.id === client.user.id);
                if (last) last.edit({ embeds: [embed] }); else ch.send({ embeds: [embed] });
            }
        }
    }
}

app.get('/dashboard/:guildId', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.send('<h1>البوت غير موجود في السيرفر</h1>');
    const config = getGuildConfig(guild.id);
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    let chOpts = '<option value="">-- اختر قناة --</option>';
    channels.forEach(c => { chOpts += `<option value="${c.id}">${c.name}</option>`; });

    res.send(`<html><head><title>Dashboard</title>${neonCSS}</head><body><div class="neon-box">
        <h1>⚙️ إعدادات ${guild.name}</h1>
        <form action="/save/${guild.id}" method="POST" enctype="multipart/form-data">
            <div class="grid">
                <div><label>اسم العملة:</label><input type="text" name="coinName" value="${config.coinName}"></div>
                <div><label>إيموجي (ID أو رمز):</label><input type="text" name="coinEmoji" value="${config.coinEmoji}"></div>
            </div>
            <div class="grid">
                <div><label>أمر الرصيد:</label><input type="text" name="balanceCmd" value="${config.balanceCmd}"></div>
                <div><label>أمر التوب:</label><input type="text" name="topCmd" value="${config.topCmd}"></div>
            </div>
            <div class="grid">
                <div><label>هدف الرسائل:</label><input type="number" name="msgGoal" value="${config.msgGoal}"></div>
                <div><label>جائزة التفاعل:</label><input type="number" name="msgReward" value="${config.msgReward}"></div>
            </div>
            <label>شكل عرض النقاط:</label>
            <select name="formatType">
                <option value="classic" ${config.formatType==='classic'?'selected':''}>[ 🪙 1,000 ]</option>
                <option value="neon" ${config.formatType==='neon'?'selected':''}>⚡ 🪙 1K</option>
                <option value="bold" ${config.formatType==='bold'?'selected':''}>**🪙 1,000**</option>
            </select>
            <label>روم اللوق:</label><select name="logChannel">${chOpts.replace(`value="${config.logChannel}"`, `value="${config.logChannel}" selected`)}</select>
            <label>روم التوب:</label><select name="topChannel">${chOpts.replace(`value="${config.topChannel}"`, `value="${config.topChannel}" selected`)}</select>
            <label>رفع صورة التوب (Leaderboard):</label><input type="file" name="topBannerFile" accept="image/*">
            <button type="submit" class="btn">حفظ الإعدادات 🚀</button>
        </form>
        <a href="/callback" style="color:#45a29e; font-size:0.8em; text-decoration:none;">العودة للقائمة</a>
    </div></body></html>`);
});

app.post('/save/:guildId', upload.single('topBannerFile'), (req, res) => {
    const db = readDB();
    const config = db.guilds[req.params.guildId];
    const updates = { ...req.body };
    if (req.file) updates.topBanner = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    db.guilds[req.params.guildId] = { ...config, ...updates };
    saveDB(db);
    res.send(`<html><head>${neonCSS}</head><body><div class="neon-box"><h1>✅ تم الحفظ</h1><a href="/dashboard/${req.params.guildId}" class="btn">رجوع</a></div></body></html>`);
});

client.login(process.env.DISCORD_TOKEN);
app.listen(port, () => console.log(`Server: ${port}`));
