#!/usr/bin/env node

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, Partials } = require('discord.js');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// ============================================================
// DATABASE (JSON File Based)
// ============================================================
const DB_PATH = path.join(__dirname, 'database.json');

function loadDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({
            guildId: null,
            defaultPointsName: 'COIN',
            pointsPerMessage: 1,
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

function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function initUser(db, userId, username) {
    if (!userId) return null;
    if (!db.users[userId]) {
        db.users[userId] = { points: 0, username: username || 'Unknown' };
        saveDB(db);
    }
    if (username && db.users[userId].username !== username) {
        db.users[userId].username = username;
        saveDB(db);
    }
    return db.users[userId];
}

let db = loadDB();

// ============================================================
// DISCORD CLIENT
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

// ============================================================
// TOKEN & CONFIG FROM ENVIRONMENT
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const API_PORT = process.env.PORT || process.env.API_PORT || 3000;
const GUILD_ID = process.env.GUILD_ID || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
let DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${API_PORT}`;

// Clean DASHBOARD_URL (remove trailing slash)
if (DASHBOARD_URL.endsWith('/')) DASHBOARD_URL = DASHBOARD_URL.slice(0, -1);

if (GUILD_ID && !db.guildId) {
    db.guildId = GUILD_ID;
    saveDB(db);
    console.log(`Auto-detected Guild ID: ${db.guildId}`);
}

// ============================================================
// LOGGING FUNCTION
// ============================================================
async function sendLog(guild, title, fields) {
    const currentDb = loadDB();
    if (!currentDb.logChannel || !guild) return;
    try {
        const logChannel = await guild.channels.fetch(currentDb.logChannel).catch(() => null);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor('#7c3aed')
            .setTimestamp();
        fields.forEach(field => {
            embed.addFields({ name: field.name, value: field.value, inline: field.inline || false });
        });
        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Log error:', err.message);
    }
}

// ============================================================
// MESSAGE HANDLER (Prefix Commands)
// ============================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const currentDb = loadDB();

    // Check allowed channels
    if (currentDb.allowedChannels && currentDb.allowedChannels.length > 0) {
        if (!currentDb.allowedChannels.includes(message.channelId)) return;
    }

    const user = initUser(currentDb, message.author.id, message.author.username);
    const pointsName = user.pointsName || currentDb.defaultPointsName;

    // Give points per message
    if (currentDb.pointsPerMessage > 0) {
        user.points = (user.points || 0) + currentDb.pointsPerMessage;
        saveDB(currentDb);
    }

    const content = message.content.trim();
    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();

    // Points / Transfer command
    if (command === pointsName.toLowerCase()) {
        if (parts.length >= 3) {
            const mention = parts[1];
            const amount = parseInt(parts[2]);
            const targetUserId = mention.replace(/[^0-9]/g, '');

            if (!targetUserId || isNaN(amount) || amount <= 0) {
                return message.reply(`> طريقة التحويل: \`${pointsName} @المستخدم العدد\``);
            }

            if (user.points < amount) {
                return message.reply('> ما عندك نقاط كافية!');
            }

            const target = initUser(currentDb, targetUserId, null);
            if (!target) return message.reply('> المستخدم غير موجود!');

            user.points -= amount;
            target.points = (target.points || 0) + amount;
            saveDB(currentDb);

            const embed = new EmbedBuilder()
                .setColor('#10b981')
                .setDescription(`> **${message.author}** حوّل **${amount.toLocaleString()}** ${pointsName} إلى **<@${targetUserId}>** .`)
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            await sendLog(message.guild, 'تحويل نقاط', [
                { name: 'من', value: `<@${message.author.id}>`, inline: true },
                { name: 'إلى', value: `<@${targetUserId}>`, inline: true },
                { name: 'العدد', value: `${amount.toLocaleString()} ${pointsName}`, inline: true }
            ]);
            return;
        }

        // Show points
        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setDescription(`> **${message.author.tag}**, لديك **${(user.points || 0).toLocaleString()}** ${pointsName} في محفظتك.`)
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));
        await message.reply({ embeds: [embed] });
    }

    // Leaderboard
    if (command === 'top') {
        const topUsers = Object.entries(currentDb.users)
            .map(([userId, data]) => ({ userId, points: data.points || 0 }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        let desc = topUsers.map((u, i) => `**${i + 1}.** <@${u.userId}> : **${u.points.toLocaleString()}**`).join('\n') || '> لا يوجد مستخدمين.';
        const embed = new EmbedBuilder()
            .setColor('#7c3aed')
            .setTitle(`قائمة المتصدرين (${pointsName})`)
            .setDescription(desc);
        await message.reply({ embeds: [embed] });
    }

    // Store
    if (command === 'store') {
        if (!currentDb.storeItems || currentDb.storeItems.length === 0) {
            return message.reply('> المتجر فارغ حالياً.');
        }

        const embed = new EmbedBuilder()
            .setColor('#06b6d4')
            .setTitle('المتجر')
            .setDescription(currentDb.storeItems.map((item, i) => `**${i + 1}.** ${item.name} - **${item.price.toLocaleString()}** ${pointsName}`).join('\n'))
            .setFooter({ text: 'استخدم الأزرار بالأسفل للشراء' });

        const rows = [];
        for (let i = 0; i < currentDb.storeItems.length; i += 5) {
            const btns = currentDb.storeItems.slice(i, i + 5).map((item, idx) => 
                new ButtonBuilder().setCustomId(`buy_${item.id}`).setLabel(item.name).setStyle(ButtonStyle.Primary)
            );
            rows.push(new ActionRowBuilder().addComponents(btns));
        }
        await message.reply({ embeds: [embed], components: rows });
    }
});

// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async (interaction) => {
    const currentDb = loadDB();
    
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('buy_')) {
            const itemId = parseInt(interaction.customId.split('_')[1]);
            const item = currentDb.storeItems.find(i => i.id === itemId);
            if (!item) return interaction.reply({ content: '> المنتج غير موجود.', ephemeral: true });

            const user = initUser(currentDb, interaction.user.id, interaction.user.username);
            if (user.points < item.price) {
                return interaction.reply({ content: `> رصيدك غير كافٍ! تحتاج ${item.price} وعندك ${user.points}`, ephemeral: true });
            }

            user.points -= item.price;
            saveDB(currentDb);

            // Give role if exists
            if (item.roleId) {
                const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (member) await member.roles.add(item.roleId).catch(console.error);
            }

            await interaction.reply({ content: `> تم شراء **${item.name}** بنجاح!`, ephemeral: true });
            await sendLog(interaction.guild, 'شراء من المتجر', [
                { name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المنتج', value: item.name, inline: true },
                { name: 'السعر', value: `${item.price.toLocaleString()}`, inline: true }
            ]);
        }
    }

    if (interaction.isChatInputCommand()) {
        // Admin only slash commands
        const isAdmin = currentDb.serverAdmins.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!isAdmin) return interaction.reply({ content: '> لا تملك صلاحية.', ephemeral: true });

        if (interaction.commandName === 'addpoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const u = initUser(currentDb, target.id, target.username);
            u.points += amount;
            saveDB(currentDb);
            await interaction.reply(`> تمت إضافة **${amount}** نقطة لـ <@${target.id}>.`);
        }
        
        if (interaction.commandName === 'removepoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const u = initUser(currentDb, target.id, target.username);
            u.points = Math.max(0, u.points - amount);
            saveDB(currentDb);
            await interaction.reply(`> تم سحب **${amount}** نقطة من <@${target.id}>.`);
        }
    }
});

// ============================================================
// SLASH COMMANDS REGISTRATION
// ============================================================
const slashCommands = [
    new SlashCommandBuilder().setName('addpoints').setDescription('إضافة نقاط لمستخدم')
        .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('العدد').setRequired(true)),
    new SlashCommandBuilder().setName('removepoints').setDescription('سحب نقاط من مستخدم')
        .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('العدد').setRequired(true)),
    new SlashCommandBuilder().setName('resetpoints').setDescription('تصفير جميع النقاط')
];

client.on('ready', async () => {
    console.log(`Bot connected as ${client.user.tag}`);
    
    // Auto-detect Guild ID if not set
    if (!db.guildId && client.guilds.cache.size > 0) {
        db.guildId = client.guilds.cache.first().id;
        saveDB(db);
        console.log(`Auto-detected Guild ID: ${db.guildId}`);
    }

    if (db.guildId) {
        const guild = client.guilds.cache.get(db.guildId);
        if (guild) await guild.commands.set(slashCommands).catch(console.error);
    }
});

// ============================================================
// EXPRESS API & DASHBOARD
// ============================================================
const app = express();
app.use(express.json());
app.use(session({
    secret: 'points-system-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Helper for Discord OAuth
async function discordFetch(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.json();
}

// OAuth Routes
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
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${DASHBOARD_URL}/auth/discord/callback`
            })
        });
        const tokenData = await tokenRes.json();
        const userData = await discordFetch('https://discord.com/api/users/@me', tokenData.access_token);
        const guildsData = await discordFetch('https://discord.com/api/users/@me/guilds', tokenData.access_token);

        req.session.discordUser = { ...userData, guilds: guildsData };
        res.redirect('/');
    } catch (err) {
        console.error('OAuth Error:', err);
        res.redirect('/');
    }
});

// Admin Check Middleware
async function checkIfAdmin(discordUser, currentDb) {
    if (!discordUser) return false;
    if (currentDb.serverAdmins.includes(discordUser.id)) return true;
    if (currentDb.guildId) {
        const guild = client.guilds.cache.get(currentDb.guildId);
        if (guild) {
            const member = await guild.members.fetch(discordUser.id).catch(() => null);
            if (member && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
        }
    }
    return false;
}

const requireAuth = (req, res, next) => req.session.discordUser ? next() : res.status(401).json({ error: 'Unauthorized' });

// API Endpoints
app.get('/api/me', (req, res) => res.json(req.session.discordUser ? { loggedIn: true, user: req.session.discordUser } : { loggedIn: false }));
app.get('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.post('/api/config/personal', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    const { pointsName } = req.body;
    if (req.session.discordUser && currentDb.users[req.session.discordUser.id]) {
        currentDb.users[req.session.discordUser.id].pointsName = pointsName;
        saveDB(currentDb);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'User not found or not logged in' });
    }
});
app.get('/api/config', requireAuth, async (req, res) => {
    const currentDb = loadDB();

    const me = currentDb.users[req.session.discordUser.id] || {
        points: 0,
        pointsName: currentDb.defaultPointsName
    };

    res.json({
        pointsName: me.pointsName || currentDb.defaultPointsName,
        myPoints: me.points || 0,
        totalUsers: Object.keys(currentDb.users).length,
        totalPoints: Object.values(currentDb.users).reduce((a, b) => a + (b.points || 0), 0),
        pointsPerMessage: currentDb.pointsPerMessage,
        allowedChannels: currentDb.allowedChannels,
        logChannel: currentDb.logChannel,
        storeItems: currentDb.storeItems,
        serverAdmins: currentDb.serverAdmins
    });
});
app.post('/api/config', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    Object.assign(currentDb, req.body);
    saveDB(currentDb);
    res.json({ success: true });
});

app.get('/api/users', requireAuth, (req, res) => {
    const currentDb = loadDB();
    const users = Object.entries(currentDb.users).map(([id, data]) => ({ id, ...data })).sort((a, b) => b.points - a.points);
    res.json(users);
});

app.post('/api/addpoints', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    const { userId, amount } = req.body;
    const u = initUser(currentDb, userId, null);
    u.points += parseInt(amount);
    saveDB(currentDb);
    res.json({ success: true });
});

app.post('/api/removepoints', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    const { userId, amount } = req.body;
    const u = initUser(currentDb, userId, null);
    u.points = Math.max(0, u.points - parseInt(amount));
    saveDB(currentDb);
    res.json({ success: true });
});

app.post('/api/reset', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    Object.keys(currentDb.users).forEach(userId => {
        currentDb.users[userId].points = 0;
    });
    saveDB(currentDb);
    res.json({ success: true });
});

app.get('/api/channels', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!currentDb.guildId) return res.json([]);
    const guild = client.guilds.cache.get(currentDb.guildId);
    if (!guild) return res.json([]);
    const channels = await guild.channels.fetch();
    res.json(channels.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name })));
});

app.get('/api/roles', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!currentDb.guildId) return res.json([]);
    const guild = client.guilds.cache.get(currentDb.guildId);
    if (!guild) return res.json([]);
    const roles = await guild.roles.fetch();
    res.json(roles.map(r => ({ id: r.id, name: r.name })));
});

app.get('/api/members', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!currentDb.guildId) return res.json([]);
    const guild = client.guilds.cache.get(currentDb.guildId);
    if (!guild) return res.json([]);
    const members = await guild.members.fetch();
    res.json(members.map(m => ({ id: m.id, username: m.user.username, displayName: m.displayName })));
});

app.get('/api/store', requireAuth, (req, res) => res.json(loadDB().storeItems || []));

app.post('/api/store', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    const newItem = { ...req.body, id: Date.now() };
    currentDb.storeItems.push(newItem);
    saveDB(currentDb);
    res.json(newItem);
});

app.put('/api/store/:id', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    const itemId = parseInt(req.params.id);
    const { name, price, description, roleId } = req.body;
    const itemIndex = currentDb.storeItems.findIndex(i => i.id === itemId);
    if (itemIndex > -1) {
        currentDb.storeItems[itemIndex] = { ...currentDb.storeItems[itemIndex], name, price, description, roleId };
        saveDB(currentDb);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Item not found' });
    }
});

app.delete('/api/store/:id', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    currentDb.storeItems = currentDb.storeItems.filter(i => i.id !== parseInt(req.params.id));
    saveDB(currentDb);
    res.json({ success: true });
});

app.use((req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(404).send('Not Found');
    const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نظام النقاط</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #7c3aed;
            --primary-light: #a78bfa;
            --primary-dark: #6d28d9;
            --secondary: #06b6d4;
            --accent: #f59e0b;
            --success: #10b981;
            --danger: #ef4444;
            --bg-dark: #0a0a1a;
            --bg-card: #1a1a2e;
            --bg-glass: rgba(26, 26, 46, 0.6);
            --text: #e0e7ff;
            --text-muted: #a7b4cd;
            --border: rgba(124, 58, 237, 0.3);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Tajawal', sans-serif;
            background-color: var(--bg-dark);
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
            overflow-x: hidden;
        }

        /* Background Animation */
        .bg-animation {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
        }

        .bg-animation::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle at 20% 50%, rgba(124, 58, 237, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(6, 182, 212, 0.08) 0%, transparent 50%),
                radial-gradient(circle at 40% 80%, rgba(245, 158, 11, 0.05) 0%, transparent 50%);
            animation: bgMove 20s ease-in-out infinite;
        }

        @keyframes bgMove {

            0%,
            100% {
                transform: translate(0, 0);
            }

            33% {
                transform: translate(30px, -30px);
            }

            66% {
                transform: translate(-20px, 20px);
            }
        }

        /* Particles */
        .particle {
            position: fixed;
            width: 4px;
            height: 4px;
            background: var(--primary-light);
            border-radius: 50%;
            opacity: 0.3;
            animation: float linear infinite;
        }

        @keyframes float {
            0% {
                transform: translateY(100vh) rotate(0deg);
                opacity: 0;
            }

            10% {
                opacity: 0.3;
            }

            90% {
                opacity: 0.3;
            }

            100% {
                transform: translateY(-100vh) rotate(720deg);
                opacity: 0;
            }
        }

        /* Header */
        .header {
            padding: 16px 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(20px);
            background: rgba(10, 10, 26, 0.85);
            position: sticky;
            top: 0;
            z-index: 100;
            animation: slideDown 0.5s ease;
        }

        @keyframes slideDown {
            from {
                transform: translateY(-100%);
                opacity: 0;
            }

            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .header-logo {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-logo i {
            font-size: 28px;
            color: var(--primary);
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {

            0%,
            100% {
                transform: scale(1);
            }

            50% {
                transform: scale(1.1);
            }
        }

        .header-logo h1 {
            font-size: 20px;
            font-weight: 700;
            background: linear-gradient(135deg, var(--primary-light), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .header-user {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 2px solid var(--primary);
            object-fit: cover;
        }

        .user-name {
            font-size: 14px;
            font-weight: 600;
        }

        .btn-logout {
            padding: 8px 16px;
            border-radius: 10px;
            border: 1px solid var(--danger);
            background: transparent;
            color: var(--danger);
            font-family: 'Tajawal';
            font-size: 12px;
            cursor: pointer;
            transition: all 0.3s;
        }

        .btn-logout:hover {
            background: var(--danger);
            color: white;
        }

        /* Login Page */
        .login-page {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            flex-direction: column;
            gap: 24px;
        }

        .login-card {
            padding: 48px;
            border-radius: 24px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            backdrop-filter: blur(20px);
            text-align: center;
            animation: fadeInUp 0.6s ease;
            max-width: 420px;
            width: 90%;
        }

        .login-card i {
            font-size: 64px;
            color: var(--primary);
            margin-bottom: 20px;
        }

        .login-card h2 {
            font-size: 28px;
            margin-bottom: 8px;
            background: linear-gradient(135deg, var(--primary-light), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .login-card p {
            color: var(--text-muted);
            margin-bottom: 30px;
            font-size: 14px;
        }

        .btn-discord {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 14px 36px;
            border-radius: 14px;
            border: none;
            background: #5865F2;
            color: white;
            font-family: 'Tajawal';
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s;
            text-decoration: none;
        }

        .btn-discord:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 30px rgba(88, 101, 242, 0.4);
        }

        /* Main Layout */
        .main-container {
            display: flex;
            min-height: calc(100vh - 70px);
        }

        /* Sidebar */
        .sidebar {
            width: 240px;
            padding: 24px 16px;
            border-left: 1px solid var(--border);
            backdrop-filter: blur(10px);
            background: rgba(10, 10, 26, 0.6);
            animation: slideRight 0.5s ease 0.2s both;
        }

        @keyframes slideRight {
            from {
                transform: translateX(50px);
                opacity: 0;
            }

            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            margin-bottom: 6px;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 14px;
            font-weight: 500;
            color: var(--text-muted);
        }

        .nav-item:hover {
            background: var(--bg-glass);
            color: var(--text);
            transform: translateX(-4px);
        }

        .nav-item.active {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.2), rgba(6, 182, 212, 0.1));
            color: var(--primary-light);
            border: 1px solid rgba(124, 58, 237, 0.3);
        }

        .nav-item i {
            width: 20px;
            text-align: center;
        }

        .nav-badge {
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 10px;
            background: var(--danger);
            color: white;
            margin-right: auto;
        }

        /* Content */
        .content {
            flex: 1;
            padding: 28px 36px;
            overflow-y: auto;
        }

        /* Stats */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 28px;
            animation: fadeInUp 0.6s ease 0.3s both;
        }

        @keyframes fadeInUp {
            from {
                transform: translateY(30px);
                opacity: 0;
            }

            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .stat-card {
            padding: 22px;
            border-radius: 16px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            backdrop-filter: blur(10px);
            transition: all 0.3s;
            position: relative;
            overflow: hidden;
        }

        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            opacity: 0;
            transition: opacity 0.3s;
        }

        .stat-card:hover::before {
            opacity: 1;
        }

        .stat-card:hover {
            transform: translateY(-4px);
            border-color: rgba(124, 58, 237, 0.3);
            box-shadow: 0 8px 30px rgba(124, 58, 237, 0.1);
        }

        .stat-icon {
            width: 40px;
            height: 40px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 12px;
            font-size: 16px;
        }

        .stat-icon.purple {
            background: rgba(124, 58, 237, 0.2);
            color: var(--primary-light);
        }

        .stat-icon.cyan {
            background: rgba(6, 182, 212, 0.2);
            color: var(--secondary);
        }

        .stat-icon.amber {
            background: rgba(245, 158, 11, 0.2);
            color: var(--accent);
        }

        .stat-icon.green {
            background: rgba(16, 185, 129, 0.2);
            color: var(--success);
        }

        .stat-value {
            font-size: 26px;
            font-weight: 800;
            margin-bottom: 4px;
        }

        .stat-label {
            font-size: 12px;
            color: var(--text-muted);
        }

        /* Sections */
        .section {
            display: none;
            animation: fadeInUp 0.4s ease;
        }

        .section.active {
            display: block;
        }

        .section-title {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .section-title i {
            color: var(--primary-light);
        }

        /* Cards */
        .card {
            padding: 24px;
            border-radius: 16px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            backdrop-filter: blur(10px);
            margin-bottom: 20px;
        }

        .card-title {
            font-size: 15px;
            font-weight: 700;
            margin-bottom: 18px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--primary-light);
        }

        /* Forms */
        .form-group {
            margin-bottom: 18px;
        }

        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .form-input,
        .form-select {
            width: 100%;
            padding: 12px 16px;
            border-radius: 10px;
            border: 1px solid var(--border);
            background: var(--bg-glass);
            color: var(--text);
            font-family: 'Tajawal';
            font-size: 14px;
            transition: all 0.3s;
            outline: none;
        }

        .form-input:focus,
        .form-select:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }

        .form-select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' fill=\'%2394a3b8\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M8 11L3 6h10l-5 5z\'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: left 14px center;
        }

        .form-select option {
            background: #1a1a2e;
            color: var(--text);
        }

        /* Buttons */
        .btn {
            padding: 10px 20px;
            border-radius: 10px;
            border: none;
            font-family: 'Tajawal';
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(124, 58, 237, 0.3);
        }

        .btn-danger {
            background: linear-gradient(135deg, var(--danger), #dc2626);
            color: white;
        }

        .btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(239, 68, 68, 0.3);
        }

        .btn-success {
            background: linear-gradient(135deg, var(--success), #059669);
            color: white;
        }

        .btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.3);
        }

        .btn-secondary {
            background: var(--bg-glass);
            color: var(--text);
            border: 1px solid var(--border);
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        /* Multi-select */
        .multi-select {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid var(--border);
            background: var(--bg-glass);
            min-height: 56px;
            max-height: 140px;
            overflow-y: auto;
        }

        .multi-select-item {
            padding: 6px 12px;
            border-radius: 8px;
            background: rgba(124, 58, 237, 0.2);
            border: 1px solid rgba(124, 58, 237, 0.3);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .multi-select-item.selected {
            background: var(--primary);
            border-color: var(--primary-light);
        }

        /* Store Grid */
        .store-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }

        .store-item-card {
            padding: 20px;
            border-radius: 14px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            transition: all 0.3s;
            animation: fadeInUp 0.4s ease both;
        }

        .store-item-card:hover {
            transform: translateY(-3px);
            border-color: rgba(124, 58, 237, 0.3);
        }

        .store-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .store-item-name {
            font-size: 16px;
            font-weight: 700;
        }

        .store-item-price {
            padding: 4px 10px;
            border-radius: 16px;
            background: rgba(245, 158, 11, 0.2);
            color: var(--accent);
            font-size: 12px;
            font-weight: 600;
        }

        .store-item-desc {
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 12px;
            line-height: 1.6;
        }

        .store-item-role {
            font-size: 11px;
            color: var(--secondary);
            margin-bottom: 12px;
            padding: 5px 10px;
            background: rgba(6, 182, 212, 0.1);
            border-radius: 8px;
            display: inline-block;
        }

        .store-item-actions {
            display: flex;
            gap: 8px;
        }

        /* Users Table */
        .users-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
        }

        .users-table th,
        .users-table td {
            padding: 12px 16px;
            text-align: right;
            border-bottom: 1px solid var(--border);
        }

        .users-table th {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
        }

        .users-table td {
            font-size: 13px;
        }

        .users-table tr:hover {
            background: var(--bg-glass);
        }

        .rank-badge {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
        }

        .rank-1 {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: #000;
        }

        .rank-2 {
            background: linear-gradient(135deg, #94a3b8, #64748b);
            color: #000;
        }

        .rank-3 {
            background: linear-gradient(135deg, #b45309, #92400e);
            color: #fff;
        }

        /* Admin Tags */
        .admin-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }

        .admin-tag {
            padding: 7px 14px;
            border-radius: 10px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .admin-tag .remove-admin {
            cursor: pointer;
            color: var(--danger);
        }

        /* Toast */
        .toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-100px);
            padding: 14px 24px;
            border-radius: 12px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            backdrop-filter: blur(20px);
            z-index: 1000;
            transition: transform 0.4s ease;
            font-size: 13px;
        }

        .toast.show {
            transform: translateX(-50%) translateY(0);
        }

        .toast.success {
            border-color: var(--success);
        }

        .toast.error {
            border-color: var(--danger);
        }

        /* Modal */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .modal-overlay.active {
            display: flex;
        }

        .modal {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 28px;
            width: 90%;
            max-width: 480px;
            animation: modalIn 0.3s ease;
        }

        @keyframes modalIn {
            from {
                transform: scale(0.9);
                opacity: 0;
            }

            to {
                transform: scale(1);
                opacity: 1;
            }
        }

        .modal-title {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 20px;
        }

        .modal-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 16px;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 5px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(124, 58, 237, 0.3);
            border-radius: 3px;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .sidebar {
                display: none;
            }

            .content {
                padding: 16px;
            }

            .header {
                padding: 12px 16px;
            }

            .stats-grid {
                grid-template-columns: 1fr;
            }
        }

        /* Hidden */
        .hidden {
            display: none !important;
        }

        /* Admin badge */
        .admin-badge {
            padding: 3px 10px;
            border-radius: 6px;
            font-size: 10px;
            background: rgba(239, 68, 68, 0.2);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        /* Points name input */
        .points-name-preview {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 12px 20px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(6, 182, 212, 0.1));
            border: 1px solid var(--border);
            margin-top: 10px;
        }

        .points-name-preview span {
            font-size: 22px;
            font-weight: 800;
            background: linear-gradient(135deg, var(--primary-light), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
    </style>
</head>

<body>
    <div class="bg-animation"></div>
    <div id="particles"></div>
    <div class="toast" id="toast"></div>
    <div class="modal-overlay" id="modalOverlay">
        <div class="modal" id="modalContent"></div>
    </div>

    <!-- LOGIN PAGE -->
    <div id="loginPage" class="login-page">
        <div class="login-card">
            <i class="fab fa-discord"></i>
            <h2>نظام النقاط</h2>
            <p>سجّل دخولك بحساب ديسكورد للوصول إلى لوحة التحكم</p>
            <a href="/auth/discord" class="btn-discord">
                <i class="fab fa-discord"></i> تسجيل الدخول بديسكورد
            </a>
        </div>
    </div>

    <!-- DASHBOARD (hidden until login) -->
    <div id="dashboard" class="hidden">
        <header class="header">
            <div class="header-logo">
                <i class="fas fa-coins"></i>
                <h1>نظام النقاط</h1>
            </div>
            <div class="header-user">
                <img id="userAvatar" class="user-avatar" src="" alt="">
                <span id="userName" class="user-name"></span>
                <span id="adminBadge" class="admin-badge hidden">أدمن</span>
                <button class="btn-logout" onclick="logout()">
                    <i class="fas fa-sign-out-alt"></i> خروج
                </button>
            </div>
        </header>

        <div class="main-container">
            <!-- Sidebar -->
            <nav class="sidebar">
                <div class="nav-item active" data-section="overview" onclick="showSection('overview')">
                    <i class="fas fa-home"></i>
                    <span>الرئيسية</span>
                </div>
                <div class="nav-item" data-section="my-settings" onclick="showSection('my-settings')">
                    <i class="fas fa-user-cog"></i>
                    <span>إعداداتي</span>
                </div>
                <div class="nav-item admin-only" data-section="server-settings"
                    onclick="showSection('server-settings')">
                    <i class="fas fa-server"></i>
                    <span>إعدادات السيرفر</span>
                </div>
                <div class="nav-item admin-only" data-section="channels" onclick="showSection('channels')">
                    <i class="fas fa-hashtag"></i>
                    <span>القنوات</span>
                </div>
                <div class="nav-item" data-section="store" onclick="showSection('store')">
                    <i class="fas fa-store"></i>
                    <span>المتجر</span>
                </div>
                <div class="nav-item admin-only" data-section="admins" onclick="showSection('admins')">
                    <i class="fas fa-user-shield"></i>
                    <span>الأدمنز</span>
                </div>
                <div class="nav-item admin-only" data-section="users" onclick="showSection('users')">
                    <i class="fas fa-users"></i>
                    <span>المستخدمين</span>
                </div>
            </nav>

            <!-- Content -->
            <main class="content">
                <!-- Overview -->
                <div class="section active" id="section-overview">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon purple"><i class="fas fa-coins"></i></div>
                            <div class="stat-value" id="statMyPoints">0</div>
                            <div class="stat-label">نقاطي</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon cyan"><i class="fas fa-users"></i></div>
                            <div class="stat-value" id="statUsers">0</div>
                            <div class="stat-label">إجمالي المستخدمين</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon amber"><i class="fas fa-chart-line"></i></div>
                            <div class="stat-value" id="statTotalPoints">0</div>
                            <div class="stat-label">إجمالي النقاط</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon green"><i class="fas fa-store"></i></div>
                            <div class="stat-value" id="statStore">0</div>
                            <div class="stat-label">منتجات المتجر</div>
                        </div>
                    </div>

                    <div class="section-title"><i class="fas fa-info-circle"></i> معلومات عامة</div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-coins"></i> اسم النقاط</div>
                        <p id="infoMyPointsName" style="font-size: 14px;">COIN</p>
                    </div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-comment-dots"></i> نقاط لكل رسالة</div>
                        <p id="infoPointsPerMsg" style="font-size: 14px;">1</p>
                    </div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-hashtag"></i> القنوات المسموحة</div>
                        <p id="infoChannels" style="font-size: 14px;">0</p>
                    </div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-file-alt"></i> قناة اللوغ</div>
                        <p id="infoLog" style="font-size: 14px;">لم يتم تحديدها</p>
                    </div>
                </div>

                <!-- My Settings (Personal - everyone) -->
                <div class="section" id="section-my-settings">
                    <div class="section-title"><i class="fas fa-user-cog"></i> إعداداتي الشخصية</div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-pen"></i> اسم النقاط تبعك</div>
                        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">
                            اختار أي اسم بدك ياه لنقاطك. لما تكتب اسم النقاط بالشات بيطلعلك نقاطك.
                        </p>
                        <div class="form-group">
                            <label class="form-label">اسم النقاط</label>
                            <input type="text" class="form-input" id="myPointsName"
                                placeholder="مثال: FBI, COIN, RZ...">
                        </div>
                        <div class="points-name-preview">
                            <i class="fas fa-coins" style="color: var(--accent);"></i>
                            <span id="pointsNamePreview">COIN</span>
                        </div>
                        <button class="btn btn-primary" style="margin-top: 16px;" onclick="savePersonalSettings()">
                            <i class="fas fa-save"></i> حفظ
                        </button>
                    </div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-coins"></i> نقاطي الحالية</div>
                        <div style="display: flex; align-items: center; gap: 16px;">
                            <div style="font-size: 36px; font-weight: 900; color: var(--accent);" id="myPointsDisplay">0
                            </div>
                            <div>
                                <div style="font-size: 12px; color: var(--text-muted);">الرصيد الحالي</div>
                                <div style="font-size: 14px;" id="myPointsLabel">COIN</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Server Settings (Admin only) -->
                <div class="section" id="section-server-settings">
                    <div class="section-title"><i class="fas fa-server"></i> إعدادات السيرفر</div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-cog"></i> إعدادات عامة</div>

                        <div class="form-group">
                            <label class="form-label">النقاط الافتراضية لكل رسالة</label>
                            <input type="number" class="form-input" id="serverPointsPerMsg" placeholder="1" min="0">
                        </div>

                        <button class="btn btn-primary" onclick="saveServerSettings()">
                            <i class="fas fa-save"></i> حفظ الإعدادات
                        </button>
                    </div>
                </div>

                <!-- Channels (Admin only) -->
                <div class="section" id="section-channels">
                    <div class="section-title"><i class="fas fa-hashtag"></i> القنوات</div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-comment-dots"></i> القنوات المسموحة</div>
                        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
                            اختر القنوات اللي البوت يرد فيها. اتركها فاضية لو بدك كل القنوات.
                        </p>
                        <div class="multi-select" id="allowedChannelsSelect"></div>
                        <button class="btn btn-primary" style="margin-top: 12px;" onclick="saveChannels()">
                            <i class="fas fa-save"></i> حفظ القنوات
                        </button>
                    </div>

                    <div class="card" style="margin-top: 16px;">
                        <div class="card-title"><i class="fas fa-file-alt"></i> قناة اللوغ</div>
                        <div class="form-group">
                            <select class="form-select" id="logChannelSelect">
                                <option value="">-- اختر قناة اللوغ --</option>
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="saveLogChannel()">
                            <i class="fas fa-save"></i> حفظ
                        </button>
                    </div>
                </div>

                <!-- Store -->
                <div class="section" id="section-store">
                    <div class="section-title"><i class="fas fa-store"></i> المتجر</div>

                    <div id="adminStoreActions">
                        <button class="btn btn-success" onclick="showAddItemModal()">
                            <i class="fas fa-plus"></i> إضافة منتج
                        </button>
                    </div>

                    <div class="store-grid" id="storeItemsContainer"></div>
                </div>

                <!-- Admins (Admin only) -->
                <div class="section" id="section-admins">
                    <div class="section-title"><i class="fas fa-user-shield"></i> إدارة الأدمنز</div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-user-plus"></i> إضافة أدمن</div>
                        <div class="form-group">
                            <select class="form-select" id="adminSelect">
                                <option value="">-- اختر عضو --</option>
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="addAdmin()">
                            <i class="fas fa-plus"></i> إضافة كأدمن
                        </button>
                    </div>

                    <div class="card" style="margin-top: 16px;">
                        <div class="card-title"><i class="fas fa-list"></i> الأدمنز الحاليين</div>
                        <div class="admin-list" id="adminList"></div>
                    </div>
                </div>

                <!-- Users (Admin only) -->
                <div class="section" id="section-users">
                    <div class="section-title"><i class="fas fa-users"></i> جدول المستخدمين</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 16px;">
                        <button class="btn btn-danger" onclick="resetAllPoints()">
                            <i class="fas fa-trash"></i> ريست جميع النقاط
                        </button>
                    </div>

                    <div style="overflow-x: auto;">
                        <table class="users-table">
                            <thead>
                                <tr>
                                    <th>الترتيب</th>
                                    <th>آيدي المستخدم</th>
                                    <th>الاسم</th>
                                    <th>النقاط</th>
                                    <th>إجراءات</th>
                                </tr>
                            </thead>
                            <tbody id="usersTableBody"></tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    </div>

    <script>
        const API_BASE = '';
        let config = {};
        let channels = [];
        let roles = [];
        let members = [];
        let selectedChannels = [];
        let currentUser = null;
        let isAdmin = false;

        // Create particles
        function createParticles() {
            const container = document.getElementById('particles');
            for (let i = 0; i < 15; i++) {
                const p = document.createElement('div');
                p.className = 'particle';
                p.style.left = Math.random() * 100 + '%';
                p.style.animationDuration = (Math.random() * 10 + 10) + 's';
                p.style.animationDelay = (Math.random() * 10) + 's';
                p.style.width = (Math.random() * 4 + 2) + 'px';
                p.style.height = p.style.width;
                container.appendChild(p);
            }
        }
        createParticles();

        // Toast
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.className = 'toast ' + type;
            setTimeout(() => t.classList.add('show'), 10);
            setTimeout(() => t.classList.remove('show'), 3000);
        }

        // Section navigation
        function showSection(name) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.getElementById('section-' + name).classList.add('active');
            document.querySelector(\`.nav-item[data-section="\${name}"]\`).classList.add('active');
        }

        // Modal
        function showModal(html) {
            document.getElementById('modalContent').innerHTML = html;
            document.getElementById('modalOverlay').classList.add('active');
        }
        function hideModal() {
            document.getElementById('modalOverlay').classList.remove('active');
        }
        document.getElementById('modalOverlay').addEventListener('click', function (e) {
            if (e.target === this) hideModal();
        });

        // API calls
        async function fetchMe() {
            try {
                const res = await fetch(API_BASE + '/api/me');
                const data = await res.json();
                if (!data.loggedIn) return null;
                currentUser = data.user;
                return data.user;
            } catch { return null; }
        }

        async function fetchConfig() {
            try {
                const res = await fetch(API_BASE + '/api/config');
                if (!res.ok) return;
                config = await res.json();
                updateOverview();
                updatePersonalForm();
            } catch (err) { console.error(err); }
        }

        async function fetchChannels() {
            try {
                const res = await fetch(API_BASE + '/api/channels');
                channels = await res.json();
                updateChannelSelects();
            } catch { console.error('channels error'); }
        }

        async function fetchRoles() {
            try {
                const res = await fetch(API_BASE + '/api/roles');
                roles = await res.json();
            } catch { console.error('roles error'); }
        }

        async function fetchMembers() {
            try {
                const res = await fetch(API_BASE + '/api/members');
                members = await res.json();
                updateMemberSelect();
            } catch { console.error('members error'); }
        }

        async function fetchUsers() {
            try {
                const res = await fetch(API_BASE + '/api/users');
                updateUsersTable(await res.json());
            } catch { console.error('users error'); }
        }

        async function fetchStoreItems() {
            try {
                const res = await fetch(API_BASE + '/api/store');
                updateStoreItems(await res.json());
            } catch { console.error('store error'); }
        }

        // Update UI
        function updateOverview() {
            document.getElementById('statMyPoints').textContent = (config.myPoints || 0).toLocaleString();
            document.getElementById('statUsers').textContent = config.totalUsers || 0;
            document.getElementById('statTotalPoints').textContent = (config.totalPoints || 0).toLocaleString();
            document.getElementById('statStore').textContent = (config.storeItems || []).length;
            document.getElementById('infoMyPointsName').textContent = config.pointsName || 'COIN';
            document.getElementById('infoPointsPerMsg').textContent = config.pointsPerMessage || 1;
            document.getElementById('infoChannels').textContent = (config.allowedChannels || []).length;
            document.getElementById('infoLog').textContent = config.logChannel ? 'تم تحديدها' : 'لم يتم تحديدها';
            document.getElementById('myPointsDisplay').textContent = (config.myPoints || 0).toLocaleString();
            document.getElementById('myPointsLabel').textContent = config.pointsName || 'COIN';
        }

        function updatePersonalForm() {
            document.getElementById('myPointsName').value = config.pointsName || 'COIN';
            document.getElementById('pointsNamePreview').textContent = config.pointsName || 'COIN';
        }

        function showAdminSections() {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
        }

        function hideAdminSections() {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
        }

        // Points name preview
        document.addEventListener('input', function (e) {
            if (e.target.id === 'myPointsName') {
                document.getElementById('pointsNamePreview').textContent = e.target.value || 'COIN';
            }
        });

        // Save personal settings
        async function savePersonalSettings() {
            const name = document.getElementById('myPointsName').value.trim();
            if (!name) { showToast('اسم النقاط مطلوب!', 'error'); return; }

            try {
                await fetch(API_BASE + '/api/config/personal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pointsName: name })
                });
                fetchConfig();
                showToast('تم حفظ الإعدادات الشخصية!');
            } catch { showToast('فشل حفظ الإعدادات الشخصية!', 'error'); }
        }

        // Save server settings
        async function saveServerSettings() {
            const ppm = parseInt(document.getElementById('serverPointsPerMsg').value);
            if (isNaN(ppm) || ppm < 0) { showToast('النقاط لكل رسالة يجب أن تكون رقماً موجباً!', 'error'); return; }

            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pointsPerMessage: ppm })
                });
                config.pointsPerMessage = ppm;
                updateOverview();
                showToast('تم حفظ إعدادات السيرفر!');
            } catch { showToast('فشل حفظ إعدادات السيرفر!', 'error'); }
        }

        // Channels
        function updateChannelSelects() {
            const allowedChannelsSelect = document.getElementById('allowedChannelsSelect');
            allowedChannelsSelect.innerHTML = '';
            selectedChannels = config.allowedChannels || [];

            channels.forEach(c => {
                const item = document.createElement('div');
                item.className = \`multi-select-item \${selectedChannels.includes(c.id) ? 'selected' : ''}\`;
                item.textContent = \`#\${c.name}\`;
                item.dataset.id = c.id;
                item.onclick = () => {
                    if (selectedChannels.includes(c.id)) {
                        selectedChannels = selectedChannels.filter(id => id !== c.id);
                    } else {
                        selectedChannels.push(c.id);
                    }
                    item.classList.toggle('selected');
                };
                allowedChannelsSelect.appendChild(item);
            });

            const logChannelSelect = document.getElementById('logChannelSelect');
            logChannelSelect.innerHTML = '<option value="">-- اختر قناة اللوغ --</option>';
            channels.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = \`#\${c.name}\`;
                if (config.logChannel === c.id) opt.selected = true;
                logChannelSelect.appendChild(opt);
            });
        }

        async function saveChannels() {
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ allowedChannels: selectedChannels })
                });
                config.allowedChannels = selectedChannels;
                updateOverview();
                showToast('تم حفظ القنوات!');
            } catch { showToast('فشل حفظ القنوات!', 'error'); }
        }

        async function saveLogChannel() {
            const channelId = document.getElementById('logChannelSelect').value;
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ logChannel: channelId || null })
                });
                config.logChannel = channelId || null;
                updateOverview();
                showToast('تم حفظ قناة اللوغ!');
            } catch { showToast('فشل حفظ قناة اللوغ!', 'error'); }
        }

        // Store
        function updateStoreItems(items) {
            const container = document.getElementById('storeItemsContainer');
            container.innerHTML = '';
            if (items.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">المتجر فارغ حالياً.</p>';
                return;
            }
            items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'store-item-card';
                card.innerHTML = \`
                    <div class="store-item-header">
                        <div class="store-item-name">\${item.name}</div>
                        <div class="store-item-price">\${item.price.toLocaleString()}</div>
                    </div>
                    <div class="store-item-desc">\${item.description || 'لا يوجد وصف.'}</div>
                    \${item.roleId ? \`<div class="store-item-role">دور: <@&\${item.roleId}></div>\` : ''}
                    <div class="store-item-actions">
                        <button class="btn btn-primary" onclick="showEditItemModal(\${item.id})">
                            <i class="fas fa-edit"></i> تعديل
                        </button>
                        <button class="btn btn-danger" onclick="deleteItem(\${item.id})">
                            <i class="fas fa-trash"></i> حذف
                        </button>
                    </div>
                \`;
                container.appendChild(card);
            });
        }

        function showAddItemModal() {
            showModal(\`
                <div class="modal-title">إضافة منتج جديد</div>
                <div class="form-group">
                    <label class="form-label">اسم المنتج</label>
                    <input type="text" class="form-input" id="itemName" placeholder="مثال: رتبة VIP">
                </div>
                <div class="form-group">
                    <label class="form-label">السعر</label>
                    <input type="number" class="form-input" id="itemPrice" placeholder="100" min="0">
                </div>
                <div class="form-group">
                    <label class="form-label">الوصف (اختياري)</label>
                    <textarea class="form-input" id="itemDesc" rows="3" placeholder="وصف المنتج..."></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">الدور (اختياري)</label>
                    <select class="form-select" id="itemRole">
                        <option value="">-- اختر دور --</option>
                        \${roles.map(r => \`<option value="\${r.id}">\${r.name}</option>\`).join('')}
                    </select>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="hideModal()">إلغاء</button>
                    <button class="btn btn-primary" onclick="addItem()">
                        <i class="fas fa-plus"></i> إضافة
                    </button>
                </div>
            \`);
        }

        async function addItem() {
            const name = document.getElementById('itemName').value.trim();
            const price = parseInt(document.getElementById('itemPrice').value) || 0;
            const description = document.getElementById('itemDesc').value.trim();
            const roleId = document.getElementById('itemRole').value || null;

            if (!name || price <= 0) { showToast('الاسم والسعر مطلوبان!', 'error'); return; }

            try {
                await fetch(API_BASE + '/api/store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, price, description, roleId })
                });
                hideModal();
                fetchStoreItems();
                fetchConfig();
                showToast('تم إضافة المنتج!');
            } catch { showToast('فشل إضافة المنتج!', 'error'); }
        }

        function showEditItemModal(id) {
            const item = config.storeItems.find(i => i.id === id);
            if (!item) { showToast('المنتج غير موجود!', 'error'); return; }

            showModal(\`
                <div class="modal-title">تعديل منتج</div>
                <div class="form-group">
                    <label class="form-label">اسم المنتج</label>
                    <input type="text" class="form-input" id="editName" value="\${item.name}">
                </div>
                <div class="form-group">
                    <label class="form-label">السعر</label>
                    <input type="number" class="form-input" id="editPrice" value="\${item.price}" min="0">
                </div>
                <div class="form-group">
                    <label class="form-label">الوصف (اختياري)</label>
                    <textarea class="form-input" id="editDesc" rows="3">\${item.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">الدور (اختياري)</label>
                    <select class="form-select" id="editRole">
                        <option value="">-- اختر دور --</option>
                        \${roles.map(r => \`<option value="\${r.id}" \${item.roleId === r.id ? 'selected' : ''}>\${r.name}</option>\`).join('')}
                    </select>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="hideModal()">إلغاء</button>
                    <button class="btn btn-primary" onclick="updateItem(\${item.id})">
                        <i class="fas fa-save"></i> حفظ
                    </button>
                </div>
            \`);
        }

        async function updateItem(id) {
            const name = document.getElementById('editName').value.trim();
            const price = parseInt(document.getElementById('editPrice').value) || 0;
            const desc = document.getElementById('editDesc').value.trim();
            const roleId = document.getElementById('editRole').value || null;

            try {
                await fetch(API_BASE + '/api/store/' + id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, price, description: desc, roleId })
                });
                hideModal();
                fetchStoreItems();
                showToast('تم التعديل!');
            } catch { showToast('فشل التعديل!', 'error'); }
        }

        async function deleteItem(id) {
            if (!confirm('متأكد بدك تحذف هاد المنتج؟')) return;
            try {
                await fetch(API_BASE + '/api/store/' + id, { method: 'DELETE' });
                fetchStoreItems();
                fetchConfig();
                showToast('تم الحذف!');
            } catch { showToast('فشل الحذف!', 'error'); }
        }

        // Admins
        function updateMemberSelect() {
            const sel = document.getElementById('adminSelect');
            sel.innerHTML = '<option value="">-- اختر عضو --</option>';
            members.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.displayName || m.username;
                sel.appendChild(opt);
            });
        }

        function updateAdminList() {
            const list = document.getElementById('adminList');
            list.innerHTML = '';
            if (!config.serverAdmins || config.serverAdmins.length === 0) {
                list.innerHTML = '<p style="color: var(--text-muted);">ما في أدمنز.</p>';
                return;
            }
            config.serverAdmins.forEach(id => {
                const tag = document.createElement('div');
                tag.className = 'admin-tag';
                tag.innerHTML = \`
                    <i class="fas fa-user-shield"></i>
                    <span>\${id}</span>
                    <i class="fas fa-times remove-admin" onclick="removeAdmin('\${id}')"></i>
                \`;
                list.appendChild(tag);
            });
        }

        async function addAdmin() {
            const id = document.getElementById('adminSelect').value;
            if (!id) { showToast('اختر عضو!', 'error'); return; }
            if (!config.serverAdmins) config.serverAdmins = [];
            if (config.serverAdmins.includes(id)) { showToast('هاد العضو أدمن بالفعل!', 'error'); return; }

            config.serverAdmins.push(id);
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serverAdmins: config.serverAdmins })
                });
                updateAdminList();
                showToast('تم إضافة الأدمن!');
            } catch { showToast('فشل!', 'error'); }
        }

        async function removeAdmin(id) {
            config.serverAdmins = config.serverAdmins.filter(x => x !== id);
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ serverAdmins: config.serverAdmins })
                });
                updateAdminList();
                showToast('تم إزالة الأدمن!');
            } catch { showToast('فشل!', 'error'); }
        }

        // Users table
        function updateUsersTable(users) {
            const tbody = document.getElementById('usersTableBody');
            tbody.innerHTML = '';
            users.forEach((user, i) => {
                const tr = document.createElement('tr');
                const rc = i < 3 ? \`rank-\${i + 1}\` : '';
                tr.innerHTML = \`
                    <td><span class="rank-badge \${rc}">\${i + 1}</span></td>
                    <td style="font-size: 11px; color: var(--text-muted);">\${user.id}</td>
                    <td>\${user.username || user.id}</td>
                    <td><strong>\${(user.points || 0).toLocaleString()}</strong></td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-success" style="padding: 5px 8px; font-size: 10px;" onclick="addPointsUser('\${user.id}')">
                                <i class="fas fa-plus"></i> إضافة
                            </button>
                            <button class="btn btn-danger" style="padding: 5px 8px; font-size: 10px;" onclick="removePointsUser('\${user.id}')">
                                <i class="fas fa-minus"></i> سحب
                            </button>
                        </div>
                    </td>
                \`;
                tbody.appendChild(tr);
            });
        }

        function addPointsUser(id) {
            const amount = prompt('أدخل العدد:');
            if (!amount || isNaN(amount)) return;
            fetch(API_BASE + '/api/addpoints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: id, amount: parseInt(amount) })
            }).then(() => { fetchUsers(); fetchConfig(); showToast('تم الإضافة!'); });
        }

        function removePointsUser(id) {
            const amount = prompt('أدخل العدد:');
            if (!amount || isNaN(amount)) return;
            fetch(API_BASE + '/api/removepoints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: id, amount: parseInt(amount) })
            }).then(() => { fetchUsers(); fetchConfig(); showToast('تم السحب!'); });
        }

        async function resetAllPoints() {
            if (!confirm('متأكد بدك تريست جميع النقاط؟ ما تقدر ترجع!')) return;
            try {
                await fetch(API_BASE + '/api/reset', { method: 'POST' });
                fetchUsers(); fetchConfig();
                showToast('تم الريست!');
            } catch { showToast('فشل!', 'error'); }
        }

        // Logout
        async function logout() {
            await fetch(API_BASE + '/api/logout');
            location.reload();
        }

        // Init
        async function init() {
            const user = await fetchMe();
            if (!user) {
                document.getElementById('loginPage').classList.remove('hidden');
                document.getElementById('dashboard').classList.add('hidden');
                return;
            }

            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');

            // Set user info
            document.getElementById('userName').textContent = user.username;
            const avatarUrl = user.avatar
                ? \`https://cdn.discordapp.com/avatars/\${user.id}/\${user.avatar}.png?size=64\`
                : \`https://cdn.discordapp.com/embed/avatars/0.png\`;
            document.getElementById('userAvatar').src = avatarUrl;

            // Load data
            await fetchConfig();
            isAdmin = config.isAdmin || false;

            if (isAdmin) {
                showAdminSections();
                document.getElementById('adminBadge').classList.remove('hidden');
                document.getElementById('adminStoreActions').classList.remove('hidden');
            } else {
                hideAdminSections();
                document.getElementById('adminBadge').classList.add('hidden');
                // Hide admin store actions
                const storeActions = document.getElementById('adminStoreActions');
                if (storeActions) storeActions.classList.add('hidden');
            }

            await fetchChannels();
            await fetchRoles();
            await fetchMembers();
            await fetchStoreItems();
            await fetchUsers();

            // Update server settings form
            document.getElementById('serverPointsPerMsg').value = config.pointsPerMessage || 1;
        }

        init();
    </script>
</body>

</html>`;
    res.send(htmlContent);
});

app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${API_PORT}`);
    console.log(`Dashboard URL: ${DASHBOARD_URL}`);
});

// Login to Discord
if (BOT_TOKEN) {
    client.login(BOT_TOKEN).catch(err => console.error('Login Failed:', err.message));
} else {
    console.log('BOT_TOKEN missing. Waiting for API requests...');
}
