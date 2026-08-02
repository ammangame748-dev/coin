const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ApplicationCommandOptionType,
    PermissionFlagsBits
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const CALLBACK_URL = process.env.CALLBACK_URL; // e.g., https://your-app.render.com/auth/callback
const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Database Management ---
const DB_FILE = './database.json';
let db = {
    guilds: {}, // guildId: { settings: {}, points: {}, store: [] }
};

if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4));
}

function getGuildData(guildId) {
    if (!db.guilds[guildId]) {
        db.guilds[guildId] = {
            settings: {
                pointsName: 'Points',
                pointsCommand: 'points',
                pointsPerMessage: 1,
                logsChannel: null
            },
            points: {}, // userId: amount
            store: [] // { id, roleId, price, details }
        };
        saveDB();
    }
    return db.guilds[guildId];
}

// --- Discord Bot Client ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Register Slash Commands
    const commands = [
        {
            name: 'add-points',
            description: 'إضافة نقاط لمستخدم',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'user', type: ApplicationCommandOptionType.User, description: 'المستخدم', required: true },
                { name: 'amount', type: ApplicationCommandOptionType.Integer, description: 'الكمية', required: true }
            ]
        },
        {
            name: 'remove-points',
            description: 'سحب نقاط من مستخدم',
            default_member_permissions: PermissionFlagsBits.Administrator.toString(),
            options: [
                { name: 'user', type: ApplicationCommandOptionType.User, description: 'المستخدم', required: true },
                { name: 'amount', type: ApplicationCommandOptionType.Integer, description: 'الكمية', required: true }
            ]
        },
        {
            name: 'reset-all-points',
            description: 'تصفير جميع النقاط في السيرفر',
            default_member_permissions: PermissionFlagsBits.Administrator.toString()
        }
    ];

    await client.application.commands.set(commands);
});

// Helper for Logging
async function sendLog(guild, message) {
    const data = getGuildData(guild.id);
    if (!data.settings.logsChannel) return;
    const channel = guild.channels.cache.get(data.settings.logsChannel);
    if (channel) {
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setDescription(message)
            .setTimestamp();
        channel.send({ embeds: [embed] }).catch(() => {});
    }
}

// Bot Events
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const data = getGuildData(message.guild.id);
    const { pointsName, pointsCommand, pointsPerMessage } = data.settings;

    // Points per message
    if (pointsPerMessage > 0) {
        data.points[message.author.id] = (data.points[message.author.id] || 0) + pointsPerMessage;
        saveDB();
    }

    const content = message.content.trim().toLowerCase();
    const args = message.content.split(/\s+/);

    // TOP Command
    if (content === 'top') {
        const sorted = Object.entries(data.points)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
        
        let description = sorted.map(([id, pts], index) => {
            return `**#${index + 1}** | <@${id}> - \`${pts}\` ${pointsName}`;
        }).join('\n') || 'لا يوجد بيانات بعد.';

        const embed = new EmbedBuilder()
            .setTitle(`🏆 قائمة العشرة الأوائل - ${pointsName}`)
            .setColor('#FFD700')
            .setDescription(description)
            .setTimestamp();
        
        return message.reply({ embeds: [embed] });
    }

    // Points Display & Transfer Command
    if (args[0].toLowerCase() === pointsCommand.toLowerCase()) {
        // Transfer: [Command] @user [Amount]
        if (args.length >= 3 && message.mentions.users.first()) {
            const target = message.mentions.users.first();
            const amount = parseInt(args[2]);

            if (target.id === message.author.id) return message.reply('لا يمكنك تحويل النقاط لنفسك.');
            if (isNaN(amount) || amount <= 0) return message.reply('يرجى تحديد كمية صحيحة.');
            
            const userPoints = data.points[message.author.id] || 0;
            if (userPoints < amount) return message.reply(`ليس لديك رصيد كافٍ من ${pointsName}.`);

            data.points[message.author.id] -= amount;
            data.points[target.id] = (data.points[target.id] || 0) + amount;
            saveDB();

            message.reply(`✅ تم تحويل \`${amount}\` من ${pointsName} إلى <@${target.id}> بنجاح.`);
            sendLog(message.guild, `💸 قام <@${message.author.id}> بتحويل \`${amount}\` ${pointsName} إلى <@${target.id}>`);
            return;
        }

        // Display Points
        const pts = data.points[message.author.id] || 0;
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
            .setDescription(`> **رصيدك الحالي من ${pointsName} هو:**\n> \` ${pts} \` **${pointsName}**`)
            .setTimestamp();
        
        return message.reply({ embeds: [embed] });
    }
});

client.on('interactionCreate', async (interaction) => {
    const data = getGuildData(interaction.guildId);

    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'add-points') {
            const user = options.getUser('user');
            const amount = options.getInteger('amount');
            data.points[user.id] = (data.points[user.id] || 0) + amount;
            saveDB();
            interaction.reply(`✅ تمت إضافة \`${amount}\` ${data.settings.pointsName} لـ <@${user.id}>.`);
            sendLog(interaction.guild, `🛠️ قام <@${interaction.user.id}> بإضافة \`${amount}\` ${data.settings.pointsName} لـ <@${user.id}>`);
        }

        if (commandName === 'remove-points') {
            const user = options.getUser('user');
            const amount = options.getInteger('amount');
            data.points[user.id] = Math.max(0, (data.points[user.id] || 0) - amount);
            saveDB();
            interaction.reply(`✅ تم سحب \`${amount}\` ${data.settings.pointsName} من <@${user.id}>.`);
            sendLog(interaction.guild, `🛠️ قام <@${interaction.user.id}> بسحب \`${amount}\` ${data.settings.pointsName} من <@${user.id}>`);
        }

        if (commandName === 'reset-all-points') {
            data.points = {};
            saveDB();
            interaction.reply(`✅ تم تصفير جميع النقاط في السيرفر.`);
            sendLog(interaction.guild, `⚠️ قام <@${interaction.user.id}> بتصفير جميع النقاط في السيرفر`);
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('store_')) {
            const [,, roleId] = interaction.customId.split('_');
            const action = interaction.values[0];
            const item = data.store.find(i => i.roleId === roleId);

            if (!item) return interaction.reply({ content: 'هذا المنتج لم يعد متوفراً.', ephemeral: true });

            if (action === 'details') {
                return interaction.reply({ content: `📜 **تفاصيل الرتبة:**\n${item.details}`, ephemeral: true });
            }

            if (action === 'buy') {
                const userPoints = data.points[interaction.user.id] || 0;
                if (userPoints < item.price) {
                    return interaction.reply({ content: `❌ ليس لديك رصيد كافٍ. تحتاج إلى \`${item.price}\` ${data.settings.pointsName}.`, ephemeral: true });
                }

                const role = interaction.guild.roles.cache.get(item.roleId);
                if (!role) return interaction.reply({ content: 'الرتبة غير موجودة في السيرفر.', ephemeral: true });

                try {
                    await interaction.member.roles.add(role);
                    data.points[interaction.user.id] -= item.price;
                    saveDB();
                    interaction.reply({ content: `🎉 مبروك! لقد اشتريت رتبة <@&${item.roleId}> بنجاح.`, ephemeral: true });
                    sendLog(interaction.guild, `🛒 قام <@${interaction.user.id}> بشراء رتبة <@&${item.roleId}> مقابل \`${item.price}\` ${data.settings.pointsName}`);
                } catch (e) {
                    interaction.reply({ content: 'حدث خطأ أثناء إضافة الرتبة. تأكد من أن رتبة البوت أعلى من الرتبة المطلوبة.', ephemeral: true });
                }
            }
        }
    }
});

// --- Dashboard (Express) ---
const app = express();
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'points-bot-secret-123',
    resave: false,
    saveUninitialized: false
}));

// Dashboard UI Template (Inline to keep 1 file)
const DASHBOARD_TEMPLATE = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>لوحة تحكم البوت الاحترافية</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"/>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
        body { font-family: 'Cairo', sans-serif; background-color: #0f172a; color: #f8fafc; }
        .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); }
        .btn-primary { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); transition: all 0.3s; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4); }
        input, select, textarea { background: #1e293b !important; border: 1px solid #334155 !important; color: white !important; }
    </style>
</head>
<body class="p-4 md:p-8">
    <div class="max-w-6xl mx-auto">
        <header class="flex justify-between items-center mb-10 animate__animated animate__fadeInDown">
            <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">لوحة تحكم النقاط</h1>
            <div class="flex items-center gap-4">
                <span class="text-sm text-slate-400">مرحباً، <%= user.username %></span>
                <a href="/logout" class="text-red-400 hover:text-red-300 text-sm">تسجيل الخروج</a>
            </div>
        </header>

        <% if (!selectedGuild) { %>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 animate__animated animate__fadeInUp">
                <% guilds.forEach(guild => { %>
                    <a href="/dashboard/<%= guild.id %>" class="glass p-6 rounded-2xl hover:scale-105 transition-transform flex flex-col items-center text-center">
                        <% if (guild.icon) { %>
                            <img src="https://cdn.discordapp.com/icons/<%= guild.id %>/<%= guild.icon %>.png" class="w-20 h-20 rounded-full mb-4 shadow-lg">
                        <% } else { %>
                            <div class="w-20 h-20 rounded-full bg-slate-700 mb-4 flex items-center justify-center text-2xl"><%= guild.name[0] %></div>
                        <% } %>
                        <h3 class="font-bold text-lg"><%= guild.name %></h3>
                        <p class="text-slate-400 text-sm mt-2">إدارة الإعدادات والنقاط</p>
                    </a>
                <% }); %>
            </div>
        <% } else { %>
            <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <!-- Sidebar -->
                <div class="lg:col-span-1 space-y-4 animate__animated animate__fadeInLeft">
                    <a href="/dashboard/<%= selectedGuild.id %>" class="block glass p-4 rounded-xl hover:bg-slate-700 transition">الإعدادات العامة</a>
                    <a href="/dashboard/<%= selectedGuild.id %>/store" class="block glass p-4 rounded-xl hover:bg-slate-700 transition">إدارة المتجر</a>
                    <a href="/dashboard" class="block text-slate-400 p-4 hover:text-white">← العودة للسيرفرات</a>
                </div>

                <!-- Main Content -->
                <div class="lg:col-span-3 space-y-8 animate__animated animate__fadeInRight">
                    <% if (page === 'settings') { %>
                        <form action="/dashboard/<%= selectedGuild.id %>/settings" method="POST" class="glass p-8 rounded-3xl space-y-6">
                            <h2 class="text-2xl font-bold mb-6 border-b border-slate-700 pb-4">الإعدادات العامة</h2>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label class="block text-sm font-medium mb-2">اسم النقاط</label>
                                    <input type="text" name="pointsName" value="<%= settings.pointsName %>" class="w-full p-3 rounded-xl outline-none focus:ring-2 ring-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium mb-2">أمر عرض النقاط</label>
                                    <input type="text" name="pointsCommand" value="<%= settings.pointsCommand %>" class="w-full p-3 rounded-xl outline-none focus:ring-2 ring-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium mb-2">النقاط لكل رسالة</label>
                                    <input type="number" name="pointsPerMessage" value="<%= settings.pointsPerMessage %>" class="w-full p-3 rounded-xl outline-none focus:ring-2 ring-blue-500">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium mb-2">قناة السجلات (ID)</label>
                                    <input type="text" name="logsChannel" value="<%= settings.logsChannel %>" class="w-full p-3 rounded-xl outline-none focus:ring-2 ring-blue-500">
                                </div>
                            </div>
                            <button type="submit" class="btn-primary w-full py-4 rounded-2xl font-bold text-lg mt-4">حفظ الإعدادات</button>
                        </form>
                    <% } else if (page === 'store') { %>
                        <div class="glass p-8 rounded-3xl space-y-8">
                            <h2 class="text-2xl font-bold border-b border-slate-700 pb-4">إدارة المتجر</h2>
                            
                            <!-- Add Item Form -->
                            <form action="/dashboard/<%= selectedGuild.id %>/store/add" method="POST" class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-800/50 p-6 rounded-2xl">
                                <input type="text" name="roleId" placeholder="Role ID" class="p-3 rounded-xl outline-none" required>
                                <input type="number" name="price" placeholder="السعر" class="p-3 rounded-xl outline-none" required>
                                <textarea name="details" placeholder="تفاصيل الرتبة..." class="md:col-span-2 p-3 rounded-xl outline-none h-24" required></textarea>
                                <button type="submit" class="md:col-span-2 bg-green-600 hover:bg-green-500 py-3 rounded-xl font-bold transition">إضافة للمتجر</button>
                            </form>

                            <!-- Items List -->
                            <div class="space-y-4">
                                <% store.forEach(item => { %>
                                    <div class="flex items-center justify-between bg-slate-800/30 p-4 rounded-xl border border-slate-700">
                                        <div>
                                            <p class="font-bold">رتبة: <span class="text-blue-400"><%= item.roleId %></span></p>
                                            <p class="text-sm text-slate-400">السعر: <%= item.price %> | <%= item.details.substring(0, 30) %>...</p>
                                        </div>
                                        <a href="/dashboard/<%= selectedGuild.id %>/store/delete/<%= item.roleId %>" class="text-red-500 hover:text-red-400">حذف</a>
                                    </div>
                                <% }); %>
                            </div>

                            <hr class="border-slate-700">
                            
                            <form action="/dashboard/<%= selectedGuild.id %>/store/send" method="POST" class="space-y-4">
                                <label class="block text-sm font-medium">إرسال المتجر لقناة محددة:</label>
                                <div class="flex gap-4">
                                    <input type="text" name="channelId" placeholder="Channel ID" class="flex-1 p-3 rounded-xl outline-none" required>
                                    <button type="submit" class="btn-primary px-8 rounded-xl font-bold">إرسال الآن</button>
                                </div>
                            </form>
                        </div>
                    <% } %>
                </div>
            </div>
        <% } %>
    </div>
</body>
</html>
`;

// Routes
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.send(`
        <body style="background:#0f172a; color:white; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <div style="text-align:center;">
                <h1 style="font-size:3rem; margin-bottom:2rem;">بوت النقاط الاحترافي</h1>
                <a href="/auth/login" style="background:#5865F2; color:white; padding:1rem 2rem; border-radius:10px; text-decoration:none; font-weight:bold; font-size:1.2rem;">تسجيل الدخول عبر ديسكورد</a>
            </div>
        </body>
    `);
});

app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_URL)}&response_type=code&scope=identify%20guilds`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CALLBACK_URL,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `${tokenResponse.data.token_type} ${tokenResponse.data.access_token}` }
        });

        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { authorization: `${tokenResponse.data.token_type} ${tokenResponse.data.access_token}` }
        });

        req.session.user = userResponse.data;
        req.session.guilds = guildsResponse.data.filter(g => (g.permissions & 0x8) === 0x8); // Admin only
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const ejs = require('ejs');
    const html = ejs.render(DASHBOARD_TEMPLATE, { 
        user: req.session.user, 
        guilds: req.session.guilds, 
        selectedGuild: null 
    });
    res.send(html);
});

app.get('/dashboard/:guildId', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const guild = req.session.guilds.find(g => g.id === req.params.guildId);
    if (!guild) return res.redirect('/dashboard');

    const data = getGuildData(guild.id);
    const ejs = require('ejs');
    const html = ejs.render(DASHBOARD_TEMPLATE, { 
        user: req.session.user, 
        selectedGuild: guild, 
        settings: data.settings,
        page: 'settings'
    });
    res.send(html);
});

app.post('/dashboard/:guildId/settings', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const data = getGuildData(req.params.guildId);
    data.settings.pointsName = req.body.pointsName;
    data.settings.pointsCommand = req.body.pointsCommand;
    data.settings.pointsPerMessage = parseInt(req.body.pointsPerMessage) || 0;
    data.settings.logsChannel = req.body.logsChannel;
    saveDB();
    res.redirect(`/dashboard/${req.params.guildId}`);
});

app.get('/dashboard/:guildId/store', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    const guild = req.session.guilds.find(g => g.id === req.params.guildId);
    if (!guild) return res.redirect('/dashboard');

    const data = getGuildData(guild.id);
    const ejs = require('ejs');
    const html = ejs.render(DASHBOARD_TEMPLATE, { 
        user: req.session.user, 
        selectedGuild: guild, 
        store: data.store,
        page: 'store'
    });
    res.send(html);
});

app.post('/dashboard/:guildId/store/add', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const data = getGuildData(req.params.guildId);
    data.store.push({
        roleId: req.body.roleId,
        price: parseInt(req.body.price),
        details: req.body.details
    });
    saveDB();
    res.redirect(`/dashboard/${req.params.guildId}/store`);
});

app.get('/dashboard/:guildId/store/delete/:roleId', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const data = getGuildData(req.params.guildId);
    data.store = data.store.filter(i => i.roleId !== req.params.roleId);
    saveDB();
    res.redirect(`/dashboard/${req.params.guildId}/store`);
});

app.post('/dashboard/:guildId/store/send', async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { channelId } = req.body;
    const guild = client.guilds.cache.get(req.params.guildId);
    const channel = guild.channels.cache.get(channelId);
    
    if (channel) {
        const data = getGuildData(guild.id);
        const embed = new EmbedBuilder()
            .setTitle('🛒 متجر السيرفر')
            .setDescription('يمكنك شراء الرتب باستخدام نقاطك من هنا. اختر الرتبة لرؤية التفاصيل أو الشراء.')
            .setColor('#5865F2');

        const rows = data.store.map(item => {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`store_select_${item.roleId}`)
                    .setPlaceholder(`شراء رتبة: ${item.roleId}`)
                    .addOptions([
                        { label: 'التفاصيل', description: 'رؤية مميزات هذه الرتبة', value: 'details' },
                        { label: 'شراء', description: `السعر: ${item.price} ${data.settings.pointsName}`, value: 'buy' }
                    ])
            );
            return row;
        });

        await channel.send({ embeds: [embed], components: rows.slice(0, 5) }); // Discord limit 5 rows
    }
    res.redirect(`/dashboard/${req.params.guildId}/store`);
});

// Start Everything
client.login(BOT_TOKEN);
app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
