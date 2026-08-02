const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, Partials, StringSelectMenuBuilder } = require('discord.js');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// ============================================================
// DATABASE SYSTEM
// ============================================================
const DB_PATH = path.join(__dirname, 'database.json');

function loadDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({
            guildId: process.env.GUILD_ID || null,
            defaultPointsName: 'RZ',
            defaultPointsPerMessage: 1,
            allowedChannels: [],
            logChannel: null,
            storeChannel: null,
            serverAdmins: [],
            storeItems: [],
            users: {}
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(dbData) {
    fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2));
}

function initUser(dbData, userId, username) {
    if (!userId) return null;
    if (!dbData.users[userId]) {
        dbData.users[userId] = { points: 0, username: username || 'Unknown' };
        saveDB(dbData);
    } else if (username && dbData.users[userId].username !== username) {
        dbData.users[userId].username = username;
        saveDB(dbData);
    }
    return dbData.users[userId];
}

// ============================================================
// DISCORD BOT LOGIC
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DASHBOARD_URL = (process.env.DASHBOARD_URL || `http://localhost:${API_PORT}`).replace(/\/$/, '');

// Logging Helper
async function sendLog(guild, title, fields) {
    const db = loadDB();
    if (!db.logChannel || !guild) return;
    try {
        const channel = await guild.channels.fetch(db.logChannel).catch(() => null);
        if (!channel) return;
        const embed = new EmbedBuilder()
            .setTitle(`📜 ${title}`)
            .setColor('#7c3aed')
            .setTimestamp();
        fields.forEach(f => embed.addFields({ name: f.name, value: f.value, inline: f.inline || false }));
        await channel.send({ embeds: [embed] });
    } catch (e) { console.error('Log error:', e.message); }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    let db = loadDB();
    const pointsName = db.defaultPointsName || 'RZ';
    const content = message.content.trim();
    const args = content.split(/\s+/);
    const command = args[0].toLowerCase();

    // 1. Points per message
    if (db.allowedChannels.length === 0 || db.allowedChannels.includes(message.channelId)) {
        const user = initUser(db, message.author.id, message.author.username);
        user.points += (db.defaultPointsPerMessage || 0);
        saveDB(db);
    }

    // 2. Balance Command (Name of points)
    if (command === pointsName.toLowerCase()) {
        // Transfer logic: [Name] @user [amount]
        if (args.length >= 3) {
            const targetMention = args[1];
            const amount = parseInt(args[2]);
            const targetId = targetMention.replace(/[^0-9]/g, '');
            
            if (!targetId || isNaN(amount) || amount <= 0) return;
            if (targetId === message.author.id) return message.reply('> ما تقدر تحول لنفسك يا وحش!');
            
            const sender = initUser(db, message.author.id, message.author.username);
            if (sender.points < amount) return message.reply(`> ما عندك نقاط كافية! رصيدك: **${sender.points}**`);
            
            const target = initUser(db, targetId, null);
            if (!target) return message.reply('> المستخدم غير موجود!');

            sender.points -= amount;
            target.points += amount;
            saveDB(db);

            await message.reply(`> ✅ تم تحويل **${amount.toLocaleString()}** ${pointsName} إلى <@${targetId}> بنجاح.`);
            await sendLog(message.guild, 'عملية تحويل', [
                { name: 'المرسل', value: `<@${message.author.id}>`, inline: true },
                { name: 'المستلم', value: `<@${targetId}>`, inline: true },
                { name: 'المبلغ', value: `${amount.toLocaleString()} ${pointsName}`, inline: true }
            ]);
            return;
        }

        // Show Balance
        const user = initUser(db, message.author.id, message.author.username);
        // Format exactly like screenshot: | @user, have a [0] [Name] in the wallet.
        await message.reply({ 
            content: `| <@${message.author.id}>, have a \` ${user.points.toLocaleString()} ${pointsName} \` in the wallet.` 
        });
        return;
    }

    // 3. Top Command
    if (command === 'top') {
        const topUsers = Object.entries(db.users)
            .map(([id, data]) => ({ id, points: data.points || 0 }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        let description = topUsers.map((u, i) => `• 🏆 **${i + 1}** • <@${u.id}>, \` ${db.defaultPointsName} \` \` ${u.points.toLocaleString()} \`.`).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle(`قائمة المتصدرين - ${db.defaultPointsName}`)
            .setDescription(description || '> لا يوجد بيانات حالياً.');
        
        await message.reply({ embeds: [embed] });
        return;
    }

    // 4. Store Command
    if (command === 'store') {
        if (!db.storeItems || db.storeItems.length === 0) return message.reply('> المتجر فارغ حالياً.');
        
        const select = new StringSelectMenuBuilder()
            .setCustomId('store_select')
            .setPlaceholder('اختر الرتبة التي تريدها...')
            .addOptions(db.storeItems.map(item => ({
                label: item.name,
                description: `السعر: ${item.price} ${pointsName}`,
                value: item.id.toString()
            })));

        const row = new ActionRowBuilder().addComponents(select);
        await message.reply({ content: '🛒 **متجر الرتب**\nاختر من القائمة أدناه لعرض التفاصيل أو الشراء:', components: [row] });
    }
});

client.on('interactionCreate', async (interaction) => {
    let db = loadDB();
    
    // Store Select Menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'store_select') {
        const itemId = parseInt(interaction.values[0]);
        const item = db.storeItems.find(i => i.id === itemId);
        if (!item) return interaction.reply({ content: 'المنتج غير موجود.', ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle(`💎 رتبة: ${item.name}`)
            .setColor('#06b6d4')
            .setDescription(`**السعر:** ${item.price} ${db.defaultPointsName}\n\n**الوصف:**\n${item.description || 'لا يوجد وصف.'}`)
            .setFooter({ text: 'اختر أحد الخيارات أدناه' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`store_info_${itemId}`).setLabel('التفاصيل').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`store_buy_${itemId}`).setLabel('شراء الآن').setStyle(ButtonStyle.Success)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }

    // Store Buttons
    if (interaction.isButton()) {
        const [type, action, id] = interaction.customId.split('_');
        if (type !== 'store') return;

        const itemId = parseInt(id);
        const item = db.storeItems.find(i => i.id === itemId);
        if (!item) return interaction.update({ content: 'المنتج غير موجود.', embeds: [], components: [] });

        if (action === 'info') {
            await interaction.reply({ content: `ℹ️ **تفاصيل ${item.name}:**\n${item.description || 'لا توجد تفاصيل إضافية.'}`, ephemeral: true });
        } else if (action === 'buy') {
            const user = initUser(db, interaction.user.id, interaction.user.username);
            if (user.points < item.price) return interaction.reply({ content: `> رصيدك غير كافٍ! تحتاج ${item.price} ${db.defaultPointsName}`, ephemeral: true });

            user.points -= item.price;
            saveDB(db);

            if (item.roleId) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (member) await member.roles.add(item.roleId).catch(() => null);
            }

            await interaction.reply({ content: `✅ مبروك! تم شراء **${item.name}** بنجاح.`, ephemeral: true });
            await sendLog(interaction.guild, 'عملية شراء', [
                { name: 'المشتري', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المنتج', value: item.name, inline: true },
                { name: 'السعر', value: `${item.price} ${db.defaultPointsName}`, inline: true }
            ]);
        }
    }

    // Slash Commands
    if (interaction.isChatInputCommand()) {
        const isAdmin = db.serverAdmins.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isAdmin) return interaction.reply({ content: 'لا تملك صلاحية الإدارة.', ephemeral: true });

        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (interaction.commandName === 'addpoints') {
            const u = initUser(db, target.id, target.username);
            u.points += amount;
            saveDB(db);
            await interaction.reply(`✅ تمت إضافة **${amount}** لـ <@${target.id}>.`);
            await sendLog(interaction.guild, 'إضافة نقاط (إداري)', [
                { name: 'الأدمن', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المستهدف', value: `<@${target.id}>`, inline: true },
                { name: 'الكمية', value: `${amount}`, inline: true }
            ]);
        } else if (interaction.commandName === 'removepoints') {
            const u = initUser(db, target.id, target.username);
            u.points = Math.max(0, u.points - amount);
            saveDB(db);
            await interaction.reply(`✅ تم سحب **${amount}** من <@${target.id}>.`);
            await sendLog(interaction.guild, 'سحب نقاط (إداري)', [
                { name: 'الأدمن', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المستهدف', value: `<@${target.id}>`, inline: true },
                { name: 'الكمية', value: `${amount}`, inline: true }
            ]);
        } else if (interaction.commandName === 'resetpoints') {
            for (let id in db.users) db.users[id].points = 0;
            saveDB(db);
            await interaction.reply('✅ تم تصفير جميع النقاط في السيرفر.');
            await sendLog(interaction.guild, 'تصفير النقاط', [{ name: 'الأدمن', value: `<@${interaction.user.id}>` }]);
        }
    }
});

const slashCommands = [
    new SlashCommandBuilder().setName('addpoints').setDescription('إضافة نقاط لمستخدم')
        .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
    new SlashCommandBuilder().setName('removepoints').setDescription('سحب نقاط من مستخدم')
        .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('الكمية').setRequired(true)),
    new SlashCommandBuilder().setName('resetpoints').setDescription('تصفير جميع النقاط في السيرفر')
];

client.on('ready', async () => {
    console.log(`Bot Ready: ${client.user.tag}`);
    let db = loadDB();
    if (!db.guildId && client.guilds.cache.size > 0) {
        db.guildId = client.guilds.cache.first().id;
        saveDB(db);
    }
    if (db.guildId) {
        const guild = client.guilds.cache.get(db.guildId);
        if (guild) await guild.commands.set(slashCommands).catch(() => null);
    }
});

// ============================================================
// DASHBOARD & API
// ============================================================
const app = express();
app.use(express.json());
app.use(session({
    secret: 'super-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// OAuth2 Logic
app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: `${DASHBOARD_URL}/auth/discord/callback`,
        response_type: 'code',
        scope: 'identify guilds'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');
    try {
        const response = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${DASHBOARD_URL}/auth/discord/callback`
            })
        });
        const data = await response.json();
        const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${data.access_token}` } });
        const userData = await userRes.json();
        req.session.user = userData;
        res.redirect('/');
    } catch (e) { res.redirect('/'); }
});

const checkAuth = async (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const db = loadDB();
    const isAdmin = db.serverAdmins.includes(req.session.user.id);
    const guild = client.guilds.cache.get(db.guildId);
    let isServerAdmin = false;
    if (guild) {
        const member = await guild.members.fetch(req.session.user.id).catch(() => null);
        if (member && member.permissions.has(PermissionFlagsBits.Administrator)) isServerAdmin = true;
    }
    if (isAdmin || isServerAdmin) return next();
    res.status(403).json({ error: 'Forbidden' });
};

// API Endpoints
app.get('/api/me', (req, res) => res.json(req.session.user || null));
app.get('/api/config', checkAuth, (req, res) => res.json(loadDB()));
app.post('/api/config', checkAuth, (req, res) => {
    const db = loadDB();
    Object.assign(db, req.body);
    saveDB(db);
    res.json({ success: true });
});

app.get('/api/data', checkAuth, async (req, res) => {
    const db = loadDB();
    const guild = client.guilds.cache.get(db.guildId);
    let channels = [], roles = [];
    if (guild) {
        channels = (await guild.channels.fetch()).filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
        roles = (await guild.roles.fetch()).filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name }));
    }
    res.json({ channels: Array.from(channels.values()), roles: Array.from(roles.values()) });
});

app.get('/api/users', checkAuth, (req, res) => {
    const db = loadDB();
    const users = Object.entries(db.users).map(([id, d]) => ({ id, ...d })).sort((a, b) => b.points - a.points);
    res.json(users);
});

// HTML CONTENT (The Dashboard)
const htmlContent = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard | لوحة التحكم</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root { --primary: #7c3aed; --bg: #0f172a; --card: rgba(30, 41, 59, 0.7); }
        body { background: var(--bg); color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; overflow-x: hidden; }
        .glass { background: var(--card); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; }
        .sidebar { height: 100vh; position: fixed; width: 260px; padding: 20px; z-index: 100; transition: 0.3s; }
        .main-content { margin-right: 260px; padding: 30px; min-height: 100vh; }
        .nav-link { color: #94a3b8; padding: 12px 20px; border-radius: 10px; margin-bottom: 5px; transition: 0.3s; cursor: pointer; }
        .nav-link:hover, .nav-link.active { background: var(--primary); color: white; transform: translateX(-5px); }
        .stat-card { padding: 20px; text-align: center; transition: 0.3s; }
        .stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
        .stat-icon { font-size: 2rem; margin-bottom: 10px; color: var(--primary); }
        .btn-primary { background: var(--primary); border: none; padding: 10px 25px; border-radius: 8px; }
        .form-control, .form-select { background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 8px; }
        .form-control:focus { background: rgba(15, 23, 42, 0.8); color: white; border-color: var(--primary); box-shadow: none; }
        
        /* Animations */
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate { animation: fadeIn 0.6s ease forwards; }
        .bg-animate { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; 
            background: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f172a 100%); }
        .particle { position: absolute; background: rgba(124, 58, 237, 0.2); border-radius: 50%; pointer-events: none; }

        /* Login Screen */
        .login-screen { height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; }
        .login-box { padding: 50px; width: 450px; }
    </style>
</head>
<body>
    <div class="bg-animate" id="particles"></div>

    <div id="login-container" class="login-screen d-none">
        <div class="glass login-box animate">
            <i class="fab fa-discord mb-4" style="font-size: 4rem; color: #5865F2;"></i>
            <h2 class="mb-4">لوحة تحكم النقاط</h2>
            <p class="text-muted mb-4">يجب عليك تسجيل الدخول باستخدام حساب ديسكورد لدخول لوحة التحكم.</p>
            <a href="/auth/discord" class="btn btn-primary w-100 py-3">
                <i class="fab fa-discord me-2"></i> تسجيل الدخول
            </a>
        </div>
    </div>

    <div id="app-container" class="d-none">
        <div class="sidebar glass m-3">
            <div class="text-center mb-5">
                <h4 class="fw-bold"><i class="fas fa-coins me-2"></i> POINTS SYS</h4>
            </div>
            <div class="nav flex-column">
                <div class="nav-link active" onclick="showSection('overview')"><i class="fas fa-home me-2"></i> الرئيسية</div>
                <div class="nav-link" onclick="showSection('settings')"><i class="fas fa-cog me-2"></i> الإعدادات العامة</div>
                <div class="nav-link" onclick="showSection('store')"><i class="fas fa-shopping-cart me-2"></i> المتجر</div>
                <div class="nav-link" onclick="showSection('users')"><i class="fas fa-users me-2"></i> المستخدمين</div>
                <hr class="my-3 opacity-25">
                <a href="/api/logout" class="nav-link text-danger"><i class="fas fa-sign-out-alt me-2"></i> تسجيل الخروج</a>
            </div>
        </div>

        <div class="main-content">
            <!-- Overview -->
            <section id="overview" class="section animate">
                <h2 class="mb-4">مرحباً بك، <span id="user-name">...</span></h2>
                <div class="row g-4 mb-5">
                    <div class="col-md-4">
                        <div class="glass stat-card">
                            <i class="fas fa-users stat-icon"></i>
                            <h5 class="text-muted">إجمالي المستخدمين</h5>
                            <h2 id="stat-users">0</h2>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="glass stat-card">
                            <i class="fas fa-coins stat-icon"></i>
                            <h5 class="text-muted">إجمالي النقاط</h5>
                            <h2 id="stat-points">0</h2>
                        </div>
                    </div>
                    <div class="col-md-4">
                        <div class="glass stat-card">
                            <i class="fas fa-shopping-bag stat-icon"></i>
                            <h5 class="text-muted">منتجات المتجر</h5>
                            <h2 id="stat-items">0</h2>
                        </div>
                    </div>
                </div>
                
                <div class="glass p-4">
                    <h4><i class="fas fa-chart-line me-2"></i> حالة البوت</h4>
                    <p class="text-muted">البوت متصل حالياً ويعمل على خدمة سيرفرك.</p>
                    <div class="d-flex gap-2">
                        <span class="badge bg-success p-2">ONLINE</span>
                        <span class="badge bg-primary p-2" id="guild-name">SERVER ACTIVE</span>
                    </div>
                </div>
            </section>

            <!-- Settings -->
            <section id="settings" class="section d-none animate">
                <h2 class="mb-4">الإعدادات العامة</h2>
                <div class="glass p-4">
                    <form id="config-form">
                        <div class="row g-3">
                            <div class="col-md-6">
                                <label class="form-label">اسم النقاط (مثال: FBI, RZ)</label>
                                <input type="text" class="form-control" name="defaultPointsName" required>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">النقاط لكل رسالة</label>
                                <input type="number" class="form-control" name="defaultPointsPerMessage" required>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">روم اللوق (Logs)</label>
                                <select class="form-select" name="logChannel" id="log-channels-list"></select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">روم المتجر (اختياري)</label>
                                <select class="form-select" name="storeChannel" id="store-channels-list"></select>
                            </div>
                            <div class="col-12">
                                <label class="form-label">الرومات المسموح فيها تجميع النقاط (اترك فارغ للكل)</label>
                                <div id="allowed-channels-list" class="d-flex flex-wrap gap-2 p-2 border border-secondary rounded"></div>
                            </div>
                        </div>
                        <button type="submit" class="btn btn-primary mt-4">حفظ الإعدادات</button>
                    </form>
                </div>
            </section>

            <!-- Store -->
            <section id="store" class="section d-none animate">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h2>إدارة المتجر</h2>
                    <button class="btn btn-primary" onclick="openStoreModal()">إضافة منتج جديد</button>
                </div>
                <div class="glass p-4">
                    <table class="table table-dark table-hover">
                        <thead>
                            <tr>
                                <th>الاسم</th>
                                <th>السعر</th>
                                <th>الرتبة</th>
                                <th>التحكم</th>
                            </tr>
                        </thead>
                        <tbody id="store-table"></tbody>
                    </table>
                </div>
            </section>

            <!-- Users -->
            <section id="users" class="section d-none animate">
                <h2 class="mb-4">إدارة المستخدمين</h2>
                <div class="glass p-4">
                    <div class="mb-3">
                        <input type="text" class="form-control" id="user-search" placeholder="بحث عن مستخدم..." onkeyup="filterUsers()">
                    </div>
                    <table class="table table-dark table-hover">
                        <thead>
                            <tr>
                                <th>المستخدم</th>
                                <th>النقاط</th>
                                <th>التحكم</th>
                            </tr>
                        </thead>
                        <tbody id="users-table"></tbody>
                    </table>
                </div>
            </section>
        </div>
    </div>

    <!-- Store Modal -->
    <div class="modal fade" id="storeModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content glass text-white" style="background: #1e293b">
                <div class="modal-header border-secondary">
                    <h5 class="modal-title">إضافة منتج للمتجر</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="store-form">
                        <div class="mb-3">
                            <label class="form-label">اسم المنتج/الرتبة</label>
                            <input type="text" class="form-control" id="item-name" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">السعر</label>
                            <input type="number" class="form-control" id="item-price" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">الرتبة الممنوحة (اختياري)</label>
                            <select class="form-select" id="item-role"></select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">التفاصيل (تظهر عند الضغط على زر التفاصيل)</label>
                            <textarea class="form-control" id="item-desc" rows="3"></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary w-100">إضافة المنتج</button>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        let config = {};
        let allUsers = [];
        let channels = [];
        let roles = [];

        async function init() {
            const userRes = await fetch('/api/me');
            const user = await userRes.json();
            
            if (!user) {
                document.getElementById('login-container').classList.remove('d-none');
                return;
            }

            document.getElementById('app-container').classList.remove('d-none');
            document.getElementById('user-name').innerText = user.username;
            
            await refreshData();
            createParticles();
        }

        async function refreshData() {
            const configRes = await fetch('/api/config');
            config = await configRes.json();
            
            const dataRes = await fetch('/api/data');
            const data = await dataRes.json();
            channels = data.channels;
            roles = data.roles;

            const usersRes = await fetch('/api/users');
            allUsers = await usersRes.json();

            updateUI();
        }

        function updateUI() {
            // Stats
            document.getElementById('stat-users').innerText = allUsers.length;
            document.getElementById('stat-points').innerText = allUsers.reduce((s, u) => s + (u.points || 0), 0).toLocaleString();
            document.getElementById('stat-items').innerText = config.storeItems.length;

            // Settings Form
            const form = document.getElementById('config-form');
            form.defaultPointsName.value = config.defaultPointsName;
            form.defaultPointsPerMessage.value = config.defaultPointsPerMessage;

            // Channels List
            const logSelect = document.getElementById('log-channels-list');
            const storeSelect = document.getElementById('store-channels-list');
            logSelect.innerHTML = '<option value="">اختر روم...</option>';
            storeSelect.innerHTML = '<option value="">اختر روم...</option>';
            
            channels.forEach(c => {
                logSelect.innerHTML += \`<option value="\${c.id}" \${config.logChannel === c.id ? 'selected' : ''}>\${c.name}</option>\`;
                storeSelect.innerHTML += \`<option value="\${c.id}" \${config.storeChannel === c.id ? 'selected' : ''}>\${c.name}</option>\`;
            });

            // Allowed Channels Checkboxes
            const allowedDiv = document.getElementById('allowed-channels-list');
            allowedDiv.innerHTML = '';
            channels.forEach(c => {
                const checked = config.allowedChannels.includes(c.id) ? 'checked' : '';
                allowedDiv.innerHTML += \`
                    <div class="form-check me-3">
                        <input class="form-check-input" type="checkbox" value="\${c.id}" id="ch-\${c.id}" \${checked}>
                        <label class="form-check-label" for="ch-\${c.id}">\${c.name}</label>
                    </div>\`;
            });

            // Store Table
            const storeTable = document.getElementById('store-table');
            storeTable.innerHTML = '';
            config.storeItems.forEach(item => {
                const role = roles.find(r => r.id === item.roleId);
                storeTable.innerHTML += \`
                    <tr>
                        <td>\${item.name}</td>
                        <td>\${item.price}</td>
                        <td>\${role ? role.name : 'بدون'}</td>
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="deleteItem(\${item.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>\`;
            });

            // Users Table
            renderUsers(allUsers);

            // Modal Roles
            const modalRoleSelect = document.getElementById('item-role');
            modalRoleSelect.innerHTML = '<option value="">بدون رتبة</option>';
            roles.forEach(r => {
                modalRoleSelect.innerHTML += \`<option value="\${r.id}">\${r.name}</option>\`;
            });
        }

        function renderUsers(users) {
            const table = document.getElementById('users-table');
            table.innerHTML = '';
            users.forEach(u => {
                table.innerHTML += \`
                    <tr>
                        <td>\${u.username} <small class="text-muted">(\${u.id})</small></td>
                        <td>\${(u.points || 0).toLocaleString()}</td>
                        <td>
                            <button class="btn btn-sm btn-success" onclick="modifyPoints('\${u.id}', 100)"><i class="fas fa-plus"></i></button>
                            <button class="btn btn-sm btn-warning" onclick="modifyPoints('\${u.id}', -100)"><i class="fas fa-minus"></i></button>
                        </td>
                    </tr>\`;
            });
        }

        function filterUsers() {
            const q = document.getElementById('user-search').value.toLowerCase();
            const filtered = allUsers.filter(u => u.username.toLowerCase().includes(q) || u.id.includes(q));
            renderUsers(filtered);
        }

        async function modifyPoints(userId, amount) {
            const api = amount > 0 ? '/api/addpoints' : '/api/removepoints';
            await fetch(api, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, amount: Math.abs(amount) })
            });
            refreshData();
        }

        async function deleteItem(id) {
            if (!confirm('هل أنت متأكد؟')) return;
            await fetch(\`/api/store/\${id}\`, { method: 'DELETE' });
            refreshData();
        }

        document.getElementById('config-form').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            const allowed = [];
            document.querySelectorAll('#allowed-channels-list input:checked').forEach(i => allowed.push(i.value));
            data.allowedChannels = allowed;

            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            alert('تم الحفظ بنجاح!');
            refreshData();
        };

        document.getElementById('store-form').onsubmit = async (e) => {
            e.preventDefault();
            const item = {
                name: document.getElementById('item-name').value,
                price: parseInt(document.getElementById('item-price').value),
                roleId: document.getElementById('item-role').value,
                description: document.getElementById('item-desc').value
            };
            await fetch('/api/store', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            bootstrap.Modal.getInstance(document.getElementById('storeModal')).hide();
            e.target.reset();
            refreshData();
        };

        function showSection(id) {
            document.querySelectorAll('.section').forEach(s => s.classList.add('d-none'));
            document.getElementById(id).classList.remove('d-none');
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            event.target.closest('.nav-link').classList.add('active');
        }

        function openStoreModal() {
            new bootstrap.Modal(document.getElementById('storeModal')).show();
        }

        function createParticles() {
            const container = document.getElementById('particles');
            for (let i = 0; i < 30; i++) {
                const p = document.createElement('div');
                p.className = 'particle';
                const size = Math.random() * 10 + 5;
                p.style.width = size + 'px';
                p.style.height = size + 'px';
                p.style.left = Math.random() * 100 + '%';
                p.style.top = Math.random() * 100 + '%';
                p.style.animation = \`fadeIn \${Math.random() * 3 + 2}s infinite alternate\`;
                container.appendChild(p);
            }
        }

        init();
    </script>
</body>
</html>
`;

app.get('/:path*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(404).send('Not Found');
    res.send(htmlContent);
});

app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${API_PORT}`);
    console.log(`Dashboard URL: ${DASHBOARD_URL}`);
});

if (BOT_TOKEN) {
    client.login(BOT_TOKEN).catch(e => console.error('Login error:', e.message));
} else {
    console.log('BOT_TOKEN missing.');
}
