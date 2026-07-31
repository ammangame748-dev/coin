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

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
// جعل مجلد الرفع متاحاً للوصول العام لعرض الصور
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const port = process.env.PORT || 3000;

// --- الصفحة الرئيسية (Landing Page) ---
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head>
            <title>CoinMaster Pro - Welcome</title>
            <style>
                body { background: #0b0c10; color: #00f5d4; font-family: sans-serif; text-align: center; padding: 100px; }
                .container { background: #1f2833; padding: 50px; border-radius: 20px; display: inline-block; box-shadow: 0 0 30px rgba(0,245,212,0.3); }
                h1 { color: #7289da; font-size: 3em; }
                p { color: #c5c6c7; font-size: 1.2em; }
                .btn { background: #7289da; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 1.2em; transition: 0.3s; }
                .btn:hover { background: #5b6eae; box-shadow: 0 0 15px #7289da; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🪙 CoinMaster Pro</h1>
                <p>النظام الناري المتكامل لإدارة النقاط في ديسكورد</p>
                <br><br>
                <a href="/auth" class="btn">تسجيل الدخول عبر ديسكورد 🚀</a>
                <p style="margin-top:20px; font-size:0.8em; color:#888;">أو ادخل مباشرة للداش بورد إذا كنت تملك ID السيرفر: /dashboard/YOUR_SERVER_ID</p>
            </div>
        </body>
        </html>
    `);
});

// رابط تسجيل الدخول
app.get('/auth', (req, res) => {
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    const REDIRECT_URI = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify%20guilds`);
});

// رابط الكول باك (Callback)
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('فشل تسجيل الدخول: لا يوجد كود.');
    
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

        const adminGuilds = guildsResponse.data.filter(g => (g.permissions & 0x8) === 0x8);
        
        let list = '<h1>اختر سيرفر للتحكم به:</h1><ul>';
        adminGuilds.forEach(g => {
            list += `<li><a href="/dashboard/${g.id}" style="color:#00f5d4; font-size:1.5em; text-decoration:none;">🔗 ${g.name}</a></li>`;
        });
        list += '</ul>';

        res.send(`
            <html>
            <head><style>body { background: #0b0c10; color: white; font-family: sans-serif; padding: 50px; } a:hover { text-decoration: underline !important; }</style></head>
            <body>${list}</body>
            </html>
        `);
    } catch (e) {
        res.send('حدث خطأ أثناء الاتصال بديسكورد.');
    }
});

// إعداد multer لرفع الصور
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
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

// --- تنسيق النقاط ---
function formatPoints(amount, config) {
    const emoji = config.coinEmoji || '';
    switch (config.formatType) {
        case 'neon': return `⚡ ${emoji} ${amount >= 1000 ? (amount / 1000).toFixed(1) + 'K' : amount}`;
        case 'bold': return `**${emoji} ${amount.toLocaleString()}**`;
        default: return `[ ${emoji} ${amount.toLocaleString()} ]`;
    }
}

// --- أوامر السلاش الإدارية ---
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

// معالجة الأوامر النصية
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    const config = getGuildConfig(message.guild.id);
    if (message.content === config.balanceCmd) {
        const db = readDB();
        const points = db.users[`${message.guild.id}_${message.author.id}`]?.points || 0;
        const embed = new EmbedBuilder().setColor('#00f5d4').setTitle(`💰 رصيدك: ${config.coinName}`).setThumbnail(message.author.displayAvatarURL()).setDescription(`رصيدك الحالي هو:\n\n${formatPoints(points, config)}`).setFooter({ text: config.footer });
        if (config.banner) embed.setImage(config.banner); // هنا سيتم استخدام رابط الصورة المرفوعة
        message.reply({ embeds: [embed] });
    }
    if (message.content === config.topCmd) {
        const embed = await createTopEmbed(message.guild.id);
        message.reply({ embeds: [embed] });
    }
});

// معالجة أوامر السلاش
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
            if (channel) channel.send({ embeds: [new EmbedBuilder().setColor('#2ecc71').setTitle('📢 لوق العمليات').addFields({name:'المسؤول', value:user.username, inline:true}, {name:'العضو', value:target.username, inline:true}, {name:'العملية', value:commandName, inline:true}, {name:'الكمية', value:amount.toString(), inline:true}).setTimestamp()] });
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
    return new EmbedBuilder().setColor('#7289da').setTitle(`🏆 متصدرين ${config.coinName}`).setDescription(desc).setTimestamp().setFooter({ text: config.footer });
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

// --- الداش بورد المطور ---
app.get('/dashboard/:guildId', async (req, res) => {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.send('<h1>❌ البوت ليس موجوداً في هذا السيرفر!</h1>');

    const config = getGuildConfig(guildId);
    // جلب القنوات الكتابية فقط
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    
    let channelOptions = '<option value="">-- اختر قناة --</option>';
    channels.forEach(c => {
        channelOptions += `<option value="${c.id}">${c.name}</option>`;
    });

    res.send(`
        <html>
        <head>
            <title>CoinMaster Pro - Dashboard</title>
            <style>
                body { background: #0b0c10; color: #00f5d4; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; }
                .container { max-width: 600px; margin: auto; background: #1f2833; padding: 30px; border-radius: 15px; box-shadow: 0 0 20px rgba(0,245,212,0.2); }
                h1 { text-align: center; color: #7289da; }
                label { display: block; margin-top: 15px; font-weight: bold; color: #c5c6c7; }
                input, select { width: 100%; padding: 12px; margin-top: 5px; background: #0b0c10; border: 1px solid #45a29e; color: white; border-radius: 5px; box-sizing: border-box; }
                .btn { background: #7289da; color: white; border: none; padding: 15px; margin-top: 25px; width: 100%; border-radius: 5px; cursor: pointer; font-size: 1.1em; transition: 0.3s; }
                .btn:hover { background: #5b6eae; box-shadow: 0 0 10px #7289da; }
                .preview-img { max-width: 100%; margin-top: 10px; border-radius: 5px; border: 1px solid #00f5d4; }
            </style>
        </head>
        <body>
            <div class="container">
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
                        ${channelOptions.replace(`value="${config.logChannel}"`, `value="${config.logChannel}" selected`)}
                    </select>
                    
                    <label>روم التوب (تحديث تلقائي):</label>
                    <select name="topChannel">
                        ${channelOptions.replace(`value="${config.topChannel}"`, `value="${config.topChannel}" selected`)}
                    </select>
                    
                    <label>رفع بانر البطاقة (صورة):</label>
                    <input type="file" name="bannerFile" accept="image/*">
                    ${config.banner ? `<p style="color:#888">الصورة الحالية:</p><img src="${config.banner}" class="preview-img">` : ''}
                    
                    <button type="submit" class="btn">حفظ وتطبيق الإعدادات 🚀</button>
                </form>
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
    // إذا تم رفع صورة جديدة، نقوم بتحديث الرابط
    if (req.file) {
        // ملاحظة: في بيئة محلية، الرابط سيكون localhost. في الاستضافة الحقيقية يجب وضع رابط الموقع.
        const protocol = req.protocol;
        const host = req.get('host');
        updates.banner = `${protocol}://${host}/uploads/${req.file.filename}`;
    }

    db.guilds[guildId] = { ...config, ...updates };
    saveDB(db);
    res.send(`<h1>✅ تم الحفظ بنجاح!</h1><p>تم تحديث الرومات والإعدادات وصورة البانر.</p><a href="/dashboard/${guildId}" style="color:#7289da">العودة للوحة التحكم</a>`);
});

client.login(process.env.DISCORD_TOKEN);
app.listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
