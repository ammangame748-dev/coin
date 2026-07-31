require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, 
    REST, Routes, SlashCommandBuilder, ChannelType, ActivityType 
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

// --- أنظمة التتبع (في الذاكرة) ---
const msgCooldowns = new Set();
const voiceTracking = new Map(); // userId -> startTime

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ] 
});

// --- قاعدة البيانات المحلية ---
const DB_PATH = path.join(__dirname, 'database.json');
function readDB() { 
    if (!fs.existsSync(DB_PATH)) { 
        const initial = { guilds: {}, users: {} }; 
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2)); 
        return initial; 
    } 
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); 
}
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function getGuildConfig(guildId) {
    const db = readDB();
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            // الهوية والعملة
            coinName: 'كوينز',
            coinEmoji: '🪙',
            formatType: 'professional', // professional, neon
            // الأوامر
            balanceCmd: 'نقاطي',
            topCmd: 'المتصدرين',
            // القنوات
            logChannel: null,
            topChannel: null,
            blacklistChannels: [],
            // الإمباد والبطاقة
            rankBanner: null,
            topBanner: null,
            embedFooter: 'CoinMaster Pro | Dark-Neon Aesthetic',
            embedColor: '#00f5d4',
            // نظام التفاعل
            msgGoal: 50,
            msgReward: 100,
            voiceGoal: 60, // بالدقائق
            voiceReward: 200
        };
        saveDB(db);
    }
    return db.guilds[guildId];
}

function formatPoints(amount, config) {
    const emoji = config.coinEmoji || '';
    if (config.formatType === 'neon') {
        return `⚡ ${emoji} ${amount >= 1000 ? (amount / 1000).toFixed(1) + 'K' : amount}`;
    }
    return `[ ${emoji} ${amount.toLocaleString()} ]`;
}

// --- أحداث البوت ---
client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity('CoinMaster Pro 🪙', { type: ActivityType.Watching });
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const cmds = [
        new SlashCommandBuilder().setName('give').setDescription('إعطاء نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
        new SlashCommandBuilder().setName('remove').setDescription('سحب نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
        new SlashCommandBuilder().setName('reset').setDescription('تصفير النقاط').addUserOption(o => o.setName('user').setDescription('العضو (اختياري)'))
    ].map(c => c.toJSON());

    client.guilds.cache.forEach(async g => {
        try { await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, g.id), { body: cmds }); } catch (e) {}
    });

    setInterval(updateTopChannels, 10 * 60 * 1000);
});

// تتبع الرسائل
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    if (config.blacklistChannels?.includes(message.channel.id)) return;

    const db = readDB();
    const key = `${message.guild.id}_${message.author.id}`;

    // نظام التفاعل (رسائل)
    if (!msgCooldowns.has(key)) {
        if (!db.users[key]) db.users[key] = { points: 0, msgCount: 0, voiceMinutes: 0 };
        db.users[key].msgCount = (db.users[key].msgCount || 0) + 1;
        
        if (db.users[key].msgCount >= config.msgGoal) {
            db.users[key].points += config.msgReward;
            db.users[key].msgCount = 0;
            // لا يوجد تنبيه جائزة بناءً على طلبك
        }
        saveDB(db);
        msgCooldowns.add(key);
        setTimeout(() => msgCooldowns.delete(key), 3000);
    }

    // الأوامر النصية
    if (message.content === config.balanceCmd) {
        const points = db.users[key]?.points || 0;
        const embed = new EmbedBuilder()
            .setColor(config.embedColor || '#00f5d4')
            .setTitle(`👤 بطاقة رصيد: ${message.author.username}`)
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '💰 الرصيد الحالي', value: formatPoints(points, config), inline: true },
                { name: '📊 التفاعل', value: `💬 ${db.users[key]?.msgCount || 0}/${config.msgGoal} رسالة`, inline: true }
            )
            .setFooter({ text: config.embedFooter });
        if (config.rankBanner) embed.setImage(config.rankBanner);
        message.reply({ embeds: [embed] });
    }

    if (message.content === config.topCmd) {
        const embed = await createTopEmbed(message.guild.id);
        message.reply({ embeds: [embed] });
    }
});

// تتبع الصوت
client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.member.user.bot) return;
    const userId = newState.member.id;
    const guildId = newState.guild.id;
    const key = `${guildId}_${userId}`;

    // دخول الروم
    if (!oldState.channelId && newState.channelId) {
        voiceTracking.set(key, Date.now());
    }
    // خروج من الروم
    else if (oldState.channelId && !newState.channelId) {
        const startTime = voiceTracking.get(key);
        if (startTime) {
            const minutes = Math.floor((Date.now() - startTime) / 60000);
            if (minutes > 0) {
                const db = readDB();
                const config = getGuildConfig(guildId);
                if (!db.users[key]) db.users[key] = { points: 0, msgCount: 0, voiceMinutes: 0 };
                
                db.users[key].voiceMinutes = (db.users[key].voiceMinutes || 0) + minutes;
                
                while (db.users[key].voiceMinutes >= config.voiceGoal) {
                    db.users[key].points += config.voiceReward;
                    db.users[key].voiceMinutes -= config.voiceGoal;
                }
                saveDB(db);
            }
            voiceTracking.delete(key);
        }
    }
});

// أوامر السلاش
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
        if (!db.users[key]) db.users[key] = { points: 0, msgCount: 0, voiceMinutes: 0 };
        db.users[key].points = commandName === 'give' ? db.users[key].points + amount : Math.max(0, db.users[key].points - amount);
        saveDB(db);
        interaction.reply({ content: `✅ تم التعديل. الرصيد الجديد: ${formatPoints(db.users[key].points, config)}`, ephemeral: true });
        
        if (config.logChannel) {
            const ch = interaction.guild.channels.cache.get(config.logChannel);
            if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(config.embedColor).setTitle('📡 تقرير العمليات').addFields({name:'المسؤول', value:user.username, inline:true}, {name:'العضو', value:target.username, inline:true}, {name:'الكمية', value:amount.toString(), inline:true}).setTimestamp()] });
        }
    }
    if (commandName === 'reset') {
        if (target) delete db.users[key];
        else Object.keys(db.users).forEach(k => { if (k.startsWith(guildId)) delete db.users[k]; });
        saveDB(db);
        interaction.reply({ content: '✅ تم التصفير.', ephemeral: true });
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
    const embed = new EmbedBuilder().setColor(config.embedColor).setTitle(`🏆 متصدرين ${config.coinName}`).setDescription(desc).setTimestamp().setFooter({ text: config.footer || config.embedFooter });
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

// --- الداش بورد الشامل (Dark-Neon) ---
const neonCSS = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Roboto:wght@300;400;700&display=swap');
    body { background: #0b0c10; color: #c5c6c7; font-family: 'Roboto', sans-serif; margin: 0; padding: 20px; }
    .container { max-width: 900px; margin: auto; background: #1f2833; padding: 30px; border-radius: 15px; border: 1px solid #45a29e; box-shadow: 0 0 20px rgba(0,245,212,0.1); }
    h1, h2 { font-family: 'Orbitron', sans-serif; color: #66fcf1; text-shadow: 0 0 10px #66fcf1; text-align: center; }
    .section { background: #0b0c10; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #7289da; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    label { display: block; margin-top: 10px; color: #66fcf1; font-size: 0.8em; text-transform: uppercase; letter-spacing: 1px; }
    input, select, textarea { width: 100%; padding: 12px; margin-top: 5px; background: #1f2833; border: 1px solid #45a29e; color: white; border-radius: 5px; box-sizing: border-box; }
    .btn { background: #7289da; color: white; border: none; padding: 15px 30px; margin-top: 20px; width: 100%; border-radius: 5px; cursor: pointer; font-family: 'Orbitron', sans-serif; font-weight: bold; transition: 0.3s; }
    .btn:hover { background: #66fcf1; color: #0b0c10; box-shadow: 0 0 20px #66fcf1; }
    .badge { background: #45a29e; color: #0b0c10; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; font-weight: bold; }
</style>
`;

app.get('/', (req, res) => res.send(`<html><head>${neonCSS}</head><body><div class="container"><h1>🪙 CoinMaster Pro</h1><p style="text-align:center">Dark-Neon Aesthetic Dashboard</p><a href="/auth" class="btn">تسجيل دخول الإدارة 🚀</a></div></body></html>`));

app.get('/auth', (req, res) => {
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds`);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const t = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: process.env.DISCORD_REDIRECT_URI }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const g = await axios.get('https://discord.com/api/users/@me/guilds', { headers: { authorization: `Bearer ${t.data.access_token}` } });
        const adminGuilds = g.data.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n);
        let list = '<h2>اختر سيرفرك <span class="badge">ADMIN</span></h2>';
        adminGuilds.forEach(guild => { list += `<div class="section" style="display:flex; justify-content:space-between; align-items:center;"><span>${guild.name}</span><a href="/dashboard/${guild.id}" class="btn" style="width:auto; margin:0; padding:8px 20px;">تعديل</a></div>`; });
        res.send(`<html><head>${neonCSS}</head><body><div class="container">${list}</div></body></html>`);
    } catch (e) { res.send('فشل الاتصال.'); }
});

app.get('/dashboard/:guildId', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.send('البوت غير موجود.');
    const config = getGuildConfig(guild.id);
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    let chOpts = '<option value="">-- لا يوجد --</option>';
    channels.forEach(c => { chOpts += `<option value="${c.id}">${c.name}</option>`; });

    res.send(`
        <html>
        <head><title>Dashboard | ${guild.name}</title>${neonCSS}</head>
        <body>
            <div class="container">
                <h1>⚙️ إعدادات ${guild.name}</h1>
                <form action="/save/${guild.id}" method="POST" enctype="multipart/form-data">
                    
                    <div class="section">
                        <h2>🎨 الهوية والعملة</h2>
                        <div class="grid">
                            <div><label>اسم النقاط:</label><input type="text" name="coinName" value="${config.coinName}"></div>
                            <div><label>إيموجي العملة (ID):</label><input type="text" name="coinEmoji" value="${config.coinEmoji}"></div>
                        </div>
                        <label>تنسيق الرقم:</label>
                        <select name="formatType">
                            <option value="professional" ${config.formatType==='professional'?'selected':''}>[ 🪙 15,400 ] الاحترافي</option>
                            <option value="neon" ${config.formatType==='neon'?'selected':''}>⚡ 🪙 15.4K النيون</option>
                        </select>
                    </div>

                    <div class="section">
                        <h2>🛠️ التحكم بالأوامر</h2>
                        <div class="grid">
                            <div><label>أمر الرصيد:</label><input type="text" name="balanceCmd" value="${config.balanceCmd}"></div>
                            <div><label>أمر التوب:</label><input type="text" name="topCmd" value="${config.topCmd}"></div>
                        </div>
                    </div>

                    <div class="section">
                        <h2>📡 إدارة القنوات</h2>
                        <label>قناة اللوق (Logs):</label>
                        <select name="logChannel">${chOpts.replace(`value="${config.logChannel}"`, `value="${config.logChannel}" selected`)}</select>
                        <label>قناة التوب التلقائي:</label>
                        <select name="topChannel">${chOpts.replace(`value="${config.topChannel}"`, `value="${config.topChannel}" selected`)}</select>
                    </div>

                    <div class="section">
                        <h2>📈 نظام التفاعل (الرسائل والصوت)</h2>
                        <div class="grid">
                            <div><label>هدف الرسائل:</label><input type="number" name="msgGoal" value="${config.msgGoal}"></div>
                            <div><label>جائزة الرسائل:</label><input type="number" name="msgReward" value="${config.msgReward}"></div>
                        </div>
                        <div class="grid" style="margin-top:10px;">
                            <div><label>هدف الصوت (بالدقائق):</label><input type="number" name="voiceGoal" value="${config.voiceGoal}"></div>
                            <div><label>جائزة الصوت:</label><input type="number" name="voiceReward" value="${config.voiceReward}"></div>
                        </div>
                    </div>

                    <div class="section">
                        <h2>🖼️ تصميم الإمباد والبطاقات</h2>
                        <label>نص الفوتر (Footer):</label><input type="text" name="embedFooter" value="${config.embedFooter}">
                        <label>لون الإمباد (Hex):</label><input type="text" name="embedColor" value="${config.embedColor}">
                        <div class="grid">
                            <div><label>رفع بانر البطاقة:</label><input type="file" name="rankBannerFile" accept="image/*"></div>
                            <div><label>رفع بانر التوب:</label><input type="file" name="topBannerFile" accept="image/*"></div>
                        </div>
                    </div>

                    <button type="submit" class="btn">حفظ التغييرات النارية 🚀</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/save/:guildId', upload.fields([{name:'rankBannerFile'}, {name:'topBannerFile'}]), (req, res) => {
    const db = readDB();
    const config = db.guilds[req.params.guildId];
    const updates = { ...req.body };
    
    if (req.files['rankBannerFile']) updates.rankBanner = `${req.protocol}://${req.get('host')}/uploads/${req.files['rankBannerFile'][0].filename}`;
    if (req.files['topBannerFile']) updates.topBanner = `${req.protocol}://${req.get('host')}/uploads/${req.files['topBannerFile'][0].filename}`;
    
    db.guilds[req.params.guildId] = { ...config, ...updates };
    saveDB(db);
    res.send(`<html><head>${neonCSS}</head><body><div class="container"><h1>✅ تم الحفظ بنجاح</h1><a href="/dashboard/${req.params.guildId}" class="btn">رجوع للوحة التحكم</a></div></body></html>`);
});

client.login(process.env.DISCORD_TOKEN);
app.listen(port, () => console.log(`Server running on port ${port}`));
