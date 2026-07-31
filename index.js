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
const axios = require('axios'); // تأكد من وجود axios

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const port = process.env.PORT || 3000;

// --- إعدادات التصميم النيون (CSS المشترك) ---
const neonCSS = `
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Roboto:wght@300;400;700&display=swap');
        body { 
            background: #0b0c10; 
            color: #c5c6c7; 
            font-family: 'Roboto', sans-serif; 
            margin: 0; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            min-height: 100vh;
            overflow-x: hidden;
        }
        .neon-box { 
            background: #1f2833; 
            padding: 40px; 
            border-radius: 20px; 
            box-shadow: 0 0 20px rgba(0, 245, 212, 0.2), inset 0 0 10px rgba(0, 245, 212, 0.1); 
            border: 1px solid #45a29e;
            max-width: 500px;
            width: 90%;
            text-align: center;
            animation: fadeIn 1s ease-in-out;
        }
        h1 { font-family: 'Orbitron', sans-serif; color: #66fcf1; text-shadow: 0 0 10px #66fcf1; margin-bottom: 20px; }
        p { color: #45a29e; font-weight: 300; line-height: 1.6; }
        .btn { 
            display: inline-block;
            background: transparent; 
            color: #66fcf1; 
            padding: 15px 35px; 
            text-decoration: none; 
            border-radius: 50px; 
            font-weight: bold; 
            font-family: 'Orbitron', sans-serif;
            border: 2px solid #66fcf1;
            transition: 0.4s; 
            margin-top: 30px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .btn:hover { 
            background: #66fcf1; 
            color: #0b0c10; 
            box-shadow: 0 0 30px #66fcf1; 
            transform: translateY(-3px);
        }
        .guild-card {
            background: #0b0c10;
            margin: 10px 0;
            padding: 15px;
            border-radius: 10px;
            border-left: 5px solid #66fcf1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: 0.3s;
        }
        .guild-card:hover { transform: scale(1.02); background: #1f2833; }
        .guild-card a { color: #66fcf1; text-decoration: none; font-weight: bold; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        input, select { width: 100%; padding: 12px; margin-top: 8px; background: #0b0c10; border: 1px solid #45a29e; color: #66fcf1; border-radius: 5px; box-sizing: border-box; }
        label { display: block; margin-top: 15px; text-align: left; color: #66fcf1; font-size: 0.9em; text-transform: uppercase; }
    </style>
`;

// --- مسارات الويب ---
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>CoinMaster Pro | Welcome</title>${neonCSS}</head>
        <body>
            <div class="neon-box">
                <h1>🪙 COINMASTER PRO</h1>
                <p>النظام الناري المتكامل لإدارة النقاط في ديسكورد.<br>تحكم كامل، تصميم نيون، وأداء لا يقهر.</p>
                <a href="/auth" class="btn">دخول الإدارة 🚀</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/auth', (req, res) => {
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const REDIRECT_URI = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    if (!CLIENT_ID || !process.env.DISCORD_REDIRECT_URI) {
        return res.send('خطأ: لم يتم ضبط DISCORD_CLIENT_ID أو REDIRECT_URI في ملف .env');
    }
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify%20guilds`);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('فشل تسجيل الدخول: لم يتم استلام كود من ديسكورد.');
    
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token } = tokenResponse.data;
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { authorization: `Bearer ${access_token}` }
        });

        // تصفية السيرفرات التي يمتلك فيها المستخدم صلاحية Administrator (0x8)
        const adminGuilds = guildsResponse.data.filter(g => (BigInt(g.permissions) & 0x8n) === 0x8n);
        
        let guildListHTML = '';
        adminGuilds.forEach(g => {
            guildListHTML += `
                <div class="guild-card">
                    <span>${g.name}</span>
                    <a href="/dashboard/${g.id}">دخول 🔗</a>
                </div>
            `;
        });

        res.send(`
            <html>
            <head><title>Select Server</title>${neonCSS}</head>
            <body>
                <div class="neon-box">
                    <h1>سيرفراتك</h1>
                    <p>اختر السيرفر الذي تريد تعديل إعداداته:</p>
                    <div style="margin-top: 20px; max-height: 300px; overflow-y: auto; padding-right: 10px;">
                        ${guildListHTML || '<p>لا توجد سيرفرات تمتلك فيها صلاحية مسؤول.</p>'}
                    </div>
                    <a href="/" class="btn" style="font-size: 0.8em; padding: 10px 20px;">رجوع</a>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error('OAuth2 Error:', e.response?.data || e.message);
        res.send(`
            <html>
            <head><title>Error</title>${neonCSS}</head>
            <body>
                <div class="neon-box" style="border-color: #ff4d4d;">
                    <h1 style="color: #ff4d4d; text-shadow: 0 0 10px #ff4d4d;">خطأ في الاتصال</h1>
                    <p>حدث خطأ أثناء محاولة الاتصال بديسكورد. تأكد من صحة الـ Client Secret والـ Redirect URI في ملف .env وبوابة المطورين.</p>
                    <p style="font-size: 0.8em; color: #ff4d4d;">${e.response?.data?.error_description || e.message}</p>
                    <a href="/" class="btn">حاول مجدداً</a>
                </div>
            </body>
            </html>
        `);
    }
});

// --- إعداد multer لرفع الصور ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- إعداد البوت ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
});

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
            coinName: 'نقاط',
            coinEmoji: '🪙',
            balanceCmd: 'نقاطي',
            topCmd: 'المتصدرين',
            logChannel: null,
            topChannel: null,
            formatType: 'classic',
            banner: null,
            footer: 'CoinMaster Pro System'
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

// --- أوامر السلاش ---
const slashCmds = [
    new SlashCommandBuilder().setName('give').setDescription('إعطاء نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
    new SlashCommandBuilder().setName('remove').setDescription('سحب نقاط').addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
    new SlashCommandBuilder().setName('reset').setDescription('تصفير النقاط').addUserOption(o => o.setName('user').setDescription('العضو (اختياري)'))
].map(c => c.toJSON());

client.on('ready', async () => {
    console.log(`Bot Ready: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    client.guilds.cache.forEach(async (guild) => {
        try {
            await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id), { body: slashCmds });
        } catch (e) {}
    });
    setInterval(updateTopChannels, 10 * 60 * 1000);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    if (message.content === config.balanceCmd) {
        const db = readDB();
        const points = db.users[`${message.guild.id}_${message.author.id}`]?.points || 0;
        const embed = new EmbedBuilder().setColor('#66fcf1').setTitle(`💰 رصيدك: ${config.coinName}`).setThumbnail(message.author.displayAvatarURL()).setDescription(`رصيدك الحالي هو:\n\n${formatPoints(points, config)}`).setFooter({ text: config.footer });
        if (config.banner) embed.setImage(config.banner);
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
        if (!db.users[key]) db.users[key] = { points: 0 };
        db.users[key].points = commandName === 'give' ? db.users[key].points + amount : Math.max(0, db.users[key].points - amount);
        saveDB(db);
        interaction.reply({ content: `✅ تم التعديل. الرصيد الجديد: ${formatPoints(db.users[key].points, config)}`, ephemeral: true });
        
        if (config.logChannel) {
            const channel = interaction.guild.channels.cache.get(config.logChannel);
            if (channel) channel.send({ embeds: [new EmbedBuilder().setColor('#66fcf1').setTitle('📢 لوق العمليات').addFields({name:'المسؤول', value:user.username, inline:true}, {name:'العضو', value:target.username, inline:true}, {name:'العملية', value:commandName, inline:true}, {name:'الكمية', value:amount.toString(), inline:true}).setTimestamp()] });
        }
    }
    if (commandName === 'reset') {
        if (target) delete db.users[key];
        else Object.keys(db.users).forEach(k => { if (k.startsWith(guildId)) delete db.users[k]; });
        saveDB(db);
        interaction.reply({ content: '✅ تم التصفير بنجاح.', ephemeral: true });
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
    return new EmbedBuilder().setColor('#66fcf1').setTitle(`🏆 متصدرين ${config.coinName}`).setDescription(desc).setTimestamp().setFooter({ text: config.footer });
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

// --- داش بورد السيرفر ---
app.get('/dashboard/:guildId', async (req, res) => {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.send('<h1>❌ البوت ليس موجوداً في هذا السيرفر!</h1>');

    const config = getGuildConfig(guildId);
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    
    let channelOptions = '<option value="">-- اختر قناة --</option>';
    channels.forEach(c => {
        channelOptions += `<option value="${c.id}" ${config.logChannel === c.id || config.topChannel === c.id ? 'selected' : ''}>${c.name}</option>`;
    });

    res.send(`
        <html>
        <head><title>Dashboard | ${guild.name}</title>${neonCSS}</head>
        <body>
            <div class="neon-box" style="max-width: 600px;">
                <h1>⚙️ إعدادات ${guild.name}</h1>
                <form action="/save/${guildId}" method="POST" enctype="multipart/form-data">
                    <label>اسم العملة:</label>
                    <input type="text" name="coinName" value="${config.coinName}">
                    
                    <label>إيموجي العملة:</label>
                    <input type="text" name="coinEmoji" value="${config.coinEmoji}">
                    
                    <label>أمر الرصيد (نصي):</label>
                    <input type="text" name="balanceCmd" value="${config.balanceCmd}">
                    
                    <label>أمر التوب (نصي):</label>
                    <input type="text" name="topCmd" value="${config.topCmd}">
                    
                    <label>شكل عرض النقاط:</label>
                    <select name="formatType">
                        <option value="classic" ${config.formatType === 'classic' ? 'selected' : ''}>[ 🪙 1,000 ] - كلاسيك</option>
                        <option value="neon" ${config.formatType === 'neon' ? 'selected' : ''}>⚡ 🪙 1K - نيون</option>
                        <option value="bold" ${config.formatType === 'bold' ? 'selected' : ''}>**🪙 1,000** - عريض</option>
                    </select>
                    
                    <label>روم اللوق (سجل العمليات):</label>
                    <select name="logChannel">
                        ${channelOptions}
                    </select>
                    
                    <label>روم التوب (تحديث تلقائي):</label>
                    <select name="topChannel">
                        ${channelOptions}
                    </select>
                    
                    <label>رفع بانر البطاقة (صورة):</label>
                    <input type="file" name="bannerFile" accept="image/*">
                    
                    <button type="submit" class="btn">حفظ الإعدادات 🚀</button>
                </form>
                <a href="/callback" style="display:block; margin-top:15px; color:#45a29e; text-decoration:none; font-size:0.8em;">العودة لقائمة السيرفرات</a>
            </div>
        </body>
        </html>
    `);
});

app.post('/save/:guildId', upload.single('bannerFile'), (req, res) => {
    const db = readDB();
    const guildId = req.params.guildId;
    const config = db.guilds[guildId];
    const updates = { ...req.body };
    if (req.file) {
        const protocol = req.protocol;
        const host = req.get('host');
        updates.banner = `${protocol}://${host}/uploads/${req.file.filename}`;
    }
    db.guilds[guildId] = { ...config, ...updates };
    saveDB(db);
    res.send(`<html><head>${neonCSS}</head><body><div class="neon-box"><h1>✅ تم الحفظ!</h1><p>تم تحديث إعدادات سيرفرك بنجاح.</p><a href="/dashboard/${guildId}" class="btn">رجوع</a></div></body></html>`);
});

client.login(process.env.DISCORD_TOKEN);
app.listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
