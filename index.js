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
    if (currentDb.defaultPointsPerMessage > 0) {
        user.points = (user.points || 0) + currentDb.defaultPointsPerMessage;
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

app.get('/api/config', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    const isAdmin = await checkIfAdmin(req.session.discordUser, currentDb);
    const user = currentDb.users[req.session.discordUser.id] || { points: 0 };
    res.json({
        ...currentDb,
        isAdmin,
        myPoints: user.points || 0,
        totalUsers: Object.keys(currentDb.users).length,
        totalPoints: Object.values(currentDb.users).reduce((s, u) => s + (u.points || 0), 0)
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

app.get('/api/channels', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(db.guildId);
    if (!guild) return res.json([]);
    const channels = (await guild.channels.fetch()).filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name }));
    res.json(Array.from(channels.values()));
});

app.get('/api/roles', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(db.guildId);
    if (!guild) return res.json([]);
    const roles = (await guild.roles.fetch()).filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name }));
    res.json(Array.from(roles.values()));
});

app.get('/api/members', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(db.guildId);
    if (!guild) return res.json([]);
    const members = (await guild.members.fetch()).filter(m => !m.user.bot).map(m => ({ id: m.id, username: m.user.username, displayName: m.displayName }));
    res.json(Array.from(members.values()));
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

app.delete('/api/store/:id', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    if (!await checkIfAdmin(req.session.discordUser, currentDb)) return res.status(403).json({ error: 'Forbidden' });
    currentDb.storeItems = currentDb.storeItems.filter(i => i.id !== parseInt(req.params.id));
    saveDB(currentDb);
    res.json({ success: true });
});

// ============================================================
// SERVE DASHBOARD (Embedded HTML)
// ============================================================
const htmlContent = `
${fs.readFileSync('/home/ubuntu/upload/pasted_content.txt', 'utf8')}
`;

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(404).send('Not Found');
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
