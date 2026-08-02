const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, Partials } = require('discord.js');
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Simple fetch replacement that works in Node 24 without node-fetch
function simpleFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const lib = isHttps ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
        };

        if (options.body && typeof options.body === 'string') {
            reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
        }

        const req = lib.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                resolve({
                    json: () => JSON.parse(body),
                    text: () => body,
                    status: res.statusCode,
                });
            });
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

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
    if (!db.users[userId]) {
        db.users[userId] = { points: 0, username: username };
        saveDB(db);
    }
    if (db.users[userId].username !== username) {
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
// TOKEN & CONFIG
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const API_PORT = process.env.API_PORT || 3001;
const GUILD_ID = process.env.GUILD_ID || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${API_PORT}`;

if (GUILD_ID && !db.guildId) {
    db.guildId = GUILD_ID;
    saveDB(db);
}

// ============================================================
// LOGGING FUNCTION
// ============================================================
async function sendLog(guild, title, fields) {
    db = loadDB();
    if (!db.logChannel || !guild) return;
    try {
        const logChannel = await guild.channels.fetch(db.logChannel);
        if (!logChannel) return;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor('#ff4444')
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
// EMBED BUILDERS
// ============================================================
function buildPointsEmbed(user, points, pointsName) {
    return new EmbedBuilder()
        .setColor('#ffa500')
        .setDescription(`> **${user.tag}** , have a **${points.toLocaleString()}**  ${pointsName}  in the wallet.`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }));
}

function buildTopEmbed(topUsers, pointsName) {
    let description = '';
    topUsers.forEach((entry, index) => {
        const rank = index + 1;
        description += `**${rank}.** <@${entry.userId}> , ${pointsName}  **${entry.points.toLocaleString()}** .\n`;
    });
    return new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle(`${pointsName} Leaderboard`)
        .setDescription(description || '> لا يوجد مستخدمين لديهم نقاط.')
        .setFooter({ text: `${pointsName} System` });
}

// ============================================================
// MESSAGE HANDLER (Prefix Commands)
// ============================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    db = loadDB();

    // Check if message is in allowed channels
    if (db.allowedChannels && db.allowedChannels.length > 0) {
        if (!db.allowedChannels.includes(message.channelId)) return;
    }

    // Get the user's custom points name or default
    const user = initUser(db, message.author.id, message.author.username);
    const pointsName = user.pointsName || db.defaultPointsName;

    // Give points per message
    if (db.defaultPointsPerMessage && db.defaultPointsPerMessage > 0) {
        user.points = (user.points || 0) + db.defaultPointsPerMessage;
        saveDB(db);
    }

    const content = message.content.trim();
    const parts = content.split(/[\s]+/);
    const command = parts[0].toLowerCase();
    const prefixCommand = parts[0];

    // Points command - show your points
    if (prefixCommand.toLowerCase() === pointsName.toLowerCase()) {
        if (parts.length >= 3) {
            // Transfer: pointsName @user amount
            const mention = parts[1];
            const amount = parseInt(parts[2]);

            if (!mention.startsWith('<@') || !amount || amount <= 0) {
                return message.reply({ content: `> طريقة التحويل: ${pointsName} @المستخدم العدد`, allowedMentions: { repliedUser: false } });
            }

            const targetUserId = mention.replace(/[^0-9]/g, '');
            const sender = initUser(db, message.author.id, message.author.username);
            let target = initUser(db, targetUserId, targetUserId);

            if (sender.points < amount) {
                return message.reply({ content: '> ما عندك نقاط كافية!', allowedMentions: { repliedUser: false } });
            }

            sender.points -= amount;
            target.points = (target.points || 0) + amount;
            saveDB(db);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`> **${message.author}** حوّل **${amount.toLocaleString()}** ${pointsName} إلى **<@${targetUserId}>** .`)
                .setTimestamp();

            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

            await sendLog(message.guild, 'تحويل نقاط', [
                { name: 'من', value: `<@${message.author.id}>`, inline: true },
                { name: 'إلى', value: `<@${targetUserId}>`, inline: true },
                { name: 'العدد', value: `${amount.toLocaleString()} ${pointsName}`, inline: true }
            ]);
            return;
        }

        // Just show points
        if (parts.length === 1) {
            const embed = buildPointsEmbed(message.author, user.points || 0, pointsName);
            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
            return;
        }
    }

    // TOP command
    if (command === 'top') {
        const allUsers = Object.entries(db.users)
            .map(([userId, data]) => ({ userId, points: data.points || 0 }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);

        const embed = buildTopEmbed(allUsers, pointsName);
        await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
        return;
    }

    // STORE command
    if (command === 'store') {
        if (!db.storeItems || db.storeItems.length === 0) {
            await message.reply({ content: '> لا توجد منتجات بالمتجر.', allowedMentions: { repliedUser: false } });
            return;
        }

        const rows = [];
        for (let i = 0; i < db.storeItems.length; i += 5) {
            const rowButtons = db.storeItems.slice(i, i + 5).map((item, index) => {
                return new ButtonBuilder()
                    .setCustomId(`store_buy_${i + index}`)
                    .setLabel(item.name)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🛒');
            });
            rows.push(new ActionRowBuilder().addComponents(rowButtons));
        }

        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('المتجر')
            .setDescription(db.storeItems.map((item, i) => `**${i + 1}.** ${item.name} - **${item.price.toLocaleString()}** ${pointsName}`).join('\n'))
            .setFooter({ text: 'اختر منتج لعرض التفاصيل أو الشراء' });

        await message.reply({ embeds: [embed], components: rows, allowedMentions: { repliedUser: false } });
        return;
    }

    // STORE DETAILS command
    if (command === 'storedetails' || command === 'details') {
        if (!db.storeItems || db.storeItems.length === 0) {
            await message.reply({ content: '> لا توجد منتجات.', allowedMentions: { repliedUser: false } });
            return;
        }

        const rows = [];
        for (let i = 0; i < db.storeItems.length; i += 5) {
            const rowButtons = db.storeItems.slice(i, i + 5).map((item, index) => {
                return new ButtonBuilder()
                    .setCustomId(`store_details_${i + index}`)
                    .setLabel(item.name)
                    .setStyle(ButtonStyle.Secondary);
            });
            rows.push(new ActionRowBuilder().addComponents(rowButtons));
        }

        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('اختر منتج لعرض التفاصيل')
            .setDescription('اختر منتج من القائمة أدناه لمشاهدة تفاصيله.');

        await message.reply({ embeds: [embed], components: rows, allowedMentions: { repliedUser: false } });
        return;
    }
});

// ============================================================
// BUTTON INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isChatInputCommand()) return;

    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Store: Buy item
        if (customId.startsWith('store_buy_')) {
            const index = parseInt(customId.replace('store_buy_', ''));
            db = loadDB();

            if (!db.storeItems[index]) {
                await interaction.reply({ content: '> المنتج غير موجود.', ephemeral: true });
                return;
            }

            const item = db.storeItems[index];
            const user = initUser(db, interaction.user.id, interaction.user.username);
            const pointsName = user.pointsName || db.defaultPointsName;

            if (user.points < item.price) {
                await interaction.reply({
                    content: `> ما عندك نقاط كافية! تحتاج **${item.price.toLocaleString()}** ${pointsName} وعندك فقط **${(user.points || 0).toLocaleString()}** .`,
                    ephemeral: true
                });
                return;
            }

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`store_confirm_buy_${index}`)
                    .setLabel('شراء الآن')
                    .setStyle(ButtonStyle.Success)
            );

            const confirmEmbed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle(`شراء: ${item.name}`)
                .setDescription(`> **السعر:** ${item.price.toLocaleString()} ${pointsName}\n> **رصيدك:** ${(user.points || 0).toLocaleString()} ${pointsName}\n> بدك تشتري **${item.name}**؟`)
                .setTimestamp();

            await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });
            return;
        }

        // Store: Confirm buy
        if (customId.startsWith('store_confirm_buy_')) {
            const index = parseInt(customId.replace('store_confirm_buy_', ''));
            db = loadDB();

            if (!db.storeItems[index]) {
                await interaction.update({ content: '> المنتج غير موجود.', embeds: [], components: [], ephemeral: true });
                return;
            }

            const item = db.storeItems[index];
            const user = db.users[interaction.user.id];

            if (!user || (user.points || 0) < item.price) {
                await interaction.update({
                    content: '> ما عندك نقاط كافية لإتمام الشراء.',
                    embeds: [], components: [], ephemeral: true
                });
                return;
            }

            user.points -= item.price;
            saveDB(db);

            try {
                if (item.roleId) {
                    const guild = client.guilds.cache.get(db.guildId);
                    if (guild) {
                        const member = await guild.members.fetch(interaction.user.id);
                        if (member) await member.roles.add(item.roleId);
                    }
                }
            } catch (err) {
                console.error('Role add error:', err.message);
            }

            const successEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('تم الشراء بنجاح!')
                .setDescription(`> اشتريت **${item.name}** بنجاح!\n> الرصيد المتبقي: **${(user.points || 0).toLocaleString()}** ${db.defaultPointsName}`)
                .setTimestamp();

            await interaction.update({ embeds: [successEmbed], components: [], ephemeral: true });

            const guild = client.guilds.cache.get(db.guildId);
            await sendLog(guild, 'شراء من المتجر', [
                { name: 'المستخدم', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المنتج', value: item.name, inline: true },
                { name: 'السعر', value: `${item.price.toLocaleString()} ${db.defaultPointsName}`, inline: true }
            ]);
            return;
        }

        // Store: Details
        if (customId.startsWith('store_details_')) {
            const index = parseInt(customId.replace('store_details_', ''));
            db = loadDB();

            if (!db.storeItems[index]) {
                await interaction.reply({ content: '> المنتج غير موجود.', ephemeral: true });
                return;
            }

            const item = db.storeItems[index];
            const user = initUser(db, interaction.user.id, interaction.user.username);
            const pointsName = user.pointsName || db.defaultPointsName;

            const detailsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`store_buy_${index}`)
                    .setLabel('شراء الآن')
                    .setStyle(ButtonStyle.Success)
            );

            const detailsEmbed = new EmbedBuilder()
                .setColor('#3498db')
                .setTitle(item.name)
                .setDescription(item.description || '> لا يوجد وصف.')
                .addFields(
                    { name: 'السعر', value: `**${item.price.toLocaleString()}** ${pointsName}`, inline: true },
                    { name: 'الرتبة', value: item.roleId ? '<@&' + item.roleId + '>' : 'لا يوجد', inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [detailsEmbed], components: [detailsRow], ephemeral: true });
            return;
        }
        return;
    }

    // Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = interaction.commandName;
        db = loadDB();

        const isAdmin = db.serverAdmins.includes(interaction.user.id) ||
            (interaction.member && interaction.member.permissions.has(PermissionFlagsBits.Administrator));

        if (!isAdmin) {
            await interaction.reply({ content: '> ما عندك صلاحية لاستخدام هذا الأمر.', ephemeral: true });
            return;
        }

        if (command === 'addpoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const guild = client.guilds.cache.get(db.guildId);

            const user = initUser(db, target.id, target.username);
            user.points = (user.points || 0) + amount;
            saveDB(db);

            await interaction.reply({ content: `> تم إضافة **${amount.toLocaleString()}** نقطة إلى <@${target.id}> . الرصيد الجديد: **${user.points.toLocaleString()}** .` });

            await sendLog(guild, 'إضافة نقاط', [
                { name: 'الأدمن', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المستخدم', value: `<@${target.id}>`, inline: true },
                { name: 'العدد', value: `+${amount.toLocaleString()}`, inline: true }
            ]);
        }

        if (command === 'removepoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const guild = client.guilds.cache.get(db.guildId);

            const user = initUser(db, target.id, target.username);
            user.points = Math.max(0, (user.points || 0) - amount);
            saveDB(db);

            await interaction.reply({ content: `> تم سحب **${amount.toLocaleString()}** نقطة من <@${target.id}> . الرصيد الجديد: **${user.points.toLocaleString()}** .` });

            await sendLog(guild, 'سحب نقاط', [
                { name: 'الأدمن', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'المستخدم', value: `<@${target.id}>`, inline: true },
                { name: 'العدد', value: `-${amount.toLocaleString()}`, inline: true }
            ]);
        }

        if (command === 'resetpoints') {
            const guild = client.guilds.cache.get(db.guildId);
            for (const userId in db.users) {
                db.users[userId].points = 0;
            }
            saveDB(db);

            await interaction.reply({ content: '> تم ريست جميع النقاط بنجاح.' });

            await sendLog(guild, 'ريست النقاط', [
                { name: 'الأدمن', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'الإجراء', value: 'تم ريست جميع النقاط إلى 0', inline: false }
            ]);
        }
    }
});

// ============================================================
// SLASH COMMANDS REGISTRATION
// ============================================================
const slashCommands = [
    new SlashCommandBuilder()
        .setName('addpoints')
        .setDescription('إضافة نقاط لمستخدم (أدمن فقط)')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم المستهدف').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('العدد').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('removepoints')
        .setDescription('سحب نقاط من مستخدم (أدمن فقط)')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم المستهدف').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('العدد').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('resetpoints')
        .setDescription('ريست جميع النقاط (أدمن فقط)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

async function registerCommands() {
    try {
        const guild = client.guilds.cache.get(db.guildId);
        if (guild) {
            await guild.commands.set(slashCommands);
            console.log('تم تسجيل أوامر السلاش!');
        }
    } catch (err) {
        console.error('خطأ في تسجيل الأوامر:', err.message);
    }
}

client.on('ready', () => {
    console.log(`البوت متصل كـ ${client.user.tag}`);
    registerCommands();
});

client.on('guildCreate', (guild) => {
    if (!db.guildId) {
        db.guildId = guild.id;
        saveDB(db);
    }
    registerCommands();
});

// ============================================================
// API SERVER (for Dashboard) - WITH OAUTH2
// ============================================================
const app = express();
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'discord-points-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Discord OAuth2 Routes
app.get('/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: `${DASHBOARD_URL}/auth/discord/callback`,
        response_type: 'code',
        scope: 'identify guilds',
        state: Math.random().toString(36).substring(7)
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect(DASHBOARD_URL + '/');

    try {
        // Exchange code for token
        const tokenRes = await simpleFetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: `${DASHBOARD_URL}/auth/discord/callback`
            }).toString()
        });
        const tokenData = await tokenRes.json();

        // Get user info
        const userRes = await simpleFetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        // Get user guilds
        const guildsRes = await simpleFetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guildsData = await guildsRes.json();

        // Save session
        req.session.discordUser = {
            id: userData.id,
            username: userData.username,
            avatar: userData.avatar,
            discriminator: userData.discriminator,
            token: tokenData.access_token,
            guilds: guildsData
        };

        res.redirect(DASHBOARD_URL + '/');
    } catch (err) {
        console.error('OAuth error:', err);
        res.redirect(DASHBOARD_URL + '/');
    }
});

// API Routes (require auth for some)
function requireAuth(req, res, next) {
    if (!req.session.discordUser) {
        return res.status(401).json({ error: 'غير مسجل دخول' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.discordUser) {
        return res.status(401).json({ error: 'غير مسجل دخول' });
    }
    db = loadDB();
    const isAdmin = db.serverAdmins.includes(req.session.discordUser.id) ||
        (req.session.discordUser.guilds || []).some(g => {
            const guild = client.guilds.cache.get(db.guildId);
            if (!guild) return false;
            try {
                const member = guild.members.cache.get(req.session.discordUser.id);
                return member && member.permissions.has(PermissionFlagsBits.Administrator);
            } catch { return false; }
        });

    if (!isAdmin) {
        return res.status(403).json({ error: 'ما عندك صلاحية' });
    }
    next();
}

// Get current user session
app.get('/api/me', (req, res) => {
    if (!req.session.discordUser) {
        return res.json({ loggedIn: false });
    }
    res.json({
        loggedIn: true,
        user: {
            id: req.session.discordUser.id,
            username: req.session.discordUser.username,
            avatar: req.session.discordUser.avatar
        }
    });
});

// Logout
app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get config
app.get('/api/config', requireAuth, (req, res) => {
    db = loadDB();
    const userId = req.session.discordUser.id;
    const user = db.users[userId] || { points: 0, pointsName: db.defaultPointsName };

    res.json({
        guildId: db.guildId,
        pointsName: user.pointsName || db.defaultPointsName,
        pointsPerMessage: db.defaultPointsPerMessage,
        allowedChannels: db.allowedChannels,
        logChannel: db.logChannel,
        storeChannel: db.storeChannel,
        serverAdmins: db.serverAdmins,
        storeItems: db.storeItems,
        totalUsers: Object.keys(db.users).length,
        totalPoints: Object.values(db.users).reduce((sum, u) => sum + (u.points || 0), 0),
        myPoints: user.points || 0,
        isAdmin: db.serverAdmins.includes(userId)
    });
});

// Update personal config (points name)
app.post('/api/config/personal', requireAuth, (req, res) => {
    db = loadDB();
    const userId = req.session.discordUser.id;
    const { pointsName } = req.body;

    const user = initUser(db, userId, req.session.discordUser.username);
    user.pointsName = pointsName;
    saveDB(db);

    res.json({ success: true, pointsName });
});

// Admin: Update server config
app.post('/api/config', requireAdmin, (req, res) => {
    db = loadDB();
    const { pointsPerMessage, allowedChannels, logChannel, storeChannel, serverAdmins } = req.body;

    if (pointsPerMessage !== undefined) db.defaultPointsPerMessage = pointsPerMessage;
    if (allowedChannels !== undefined) db.allowedChannels = allowedChannels;
    if (logChannel !== undefined) db.logChannel = logChannel;
    if (storeChannel !== undefined) db.storeChannel = storeChannel;
    if (serverAdmins !== undefined) db.serverAdmins = serverAdmins;

    saveDB(db);
    res.json({ success: true });
});

// Store items management (admin only)
app.get('/api/store', requireAuth, (req, res) => {
    db = loadDB();
    res.json(db.storeItems || []);
});

app.post('/api/store', requireAdmin, (req, res) => {
    db = loadDB();
    const { name, price, description, roleId } = req.body;

    if (!db.storeItems) db.storeItems = [];

    db.storeItems.push({
        name: name || 'بدون اسم',
        price: price || 0,
        description: description || '',
        roleId: roleId || null,
        id: Date.now()
    });

    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

app.put('/api/store/:id', requireAdmin, (req, res) => {
    db = loadDB();
    const itemId = parseInt(req.params.id);
    const index = db.storeItems.findIndex(item => item.id === itemId);

    if (index === -1) return res.status(404).json({ error: 'المنتج غير موجود' });

    const { name, price, description, roleId } = req.body;
    if (name !== undefined) db.storeItems[index].name = name;
    if (price !== undefined) db.storeItems[index].price = price;
    if (description !== undefined) db.storeItems[index].description = description;
    if (roleId !== undefined) db.storeItems[index].roleId = roleId;

    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

app.delete('/api/store/:id', requireAdmin, (req, res) => {
    db = loadDB();
    const itemId = parseInt(req.params.id);
    db.storeItems = db.storeItems.filter(item => item.id !== itemId);
    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

// Get users list
app.get('/api/users', requireAuth, (req, res) => {
    db = loadDB();
    const users = Object.entries(db.users)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.points || 0) - (a.points || 0));
    res.json(users);
});

// Add/remove points via API (admin only)
app.post('/api/addpoints', requireAdmin, (req, res) => {
    db = loadDB();
    const { userId, amount } = req.body;
    const user = initUser(db, userId, userId);
    user.points = (user.points || 0) + amount;
    saveDB(db);
    res.json({ success: true, newBalance: user.points });
});

app.post('/api/removepoints', requireAdmin, (req, res) => {
    db = loadDB();
    const { userId, amount } = req.body;
    const user = initUser(db, userId, userId);
    user.points = Math.max(0, (user.points || 0) - amount);
    saveDB(db);
    res.json({ success: true, newBalance: user.points });
});

app.post('/api/reset', requireAdmin, (req, res) => {
    db = loadDB();
    for (const userId in db.users) {
        db.users[userId].points = 0;
    }
    saveDB(db);
    res.json({ success: true });
});

// Get guild channels
app.get('/api/channels', requireAuth, async (req, res) => {
    try {
        db = loadDB();
        const guild = client.guilds.cache.get(db.guildId);
        if (!guild) return res.json([]);

        await guild.fetch();
        const channels = guild.channels.cache
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(channels);
    } catch (err) {
        res.json([]);
    }
});

// Get guild roles
app.get('/api/roles', requireAuth, async (req, res) => {
    try {
        db = loadDB();
        const guild = client.guilds.cache.get(db.guildId);
        if (!guild) return res.json([]);

        await guild.fetch();
        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(roles);
    } catch (err) {
        res.json([]);
    }
});

// Get guild members
app.get('/api/members', requireAuth, async (req, res) => {
    try {
        db = loadDB();
        const guild = client.guilds.cache.get(db.guildId);
        if (!guild) return res.json([]);

        await guild.fetch();
        const members = guild.members.cache
            .filter(m => !m.user.bot)
            .map(m => ({ id: m.id, username: m.user.username, displayName: m.displayName }))
            .sort((a, b) => a.username.localeCompare(b.username));

        res.json(members);
    } catch (err) {
        res.json([]);
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', botOnline: client.isReady(), connectedGuilds: client.guilds.cache.size });
});

// ============================================================
// SERVE DASHBOARD - FIXED PATHS FOR RENDER
// ============================================================
// Try multiple possible paths for the dashboard
const dashboardPaths = [
    path.join(__dirname, 'dashboard', 'build'),       // Render: index.js is at root
    path.join(__dirname, '..', 'dashboard', 'build'),  // Local: index.js is in bot/
    path.join(process.cwd(), 'dashboard', 'build'),    // Fallback
    path.join(__dirname, 'build'),                     // Direct build folder
];

// Log debug info
console.log('=== Dashboard Paths ===');
dashboardPaths.forEach((p, i) => {
    const exists = fs.existsSync(p);
    console.log(`  [${i}] ${p} -> ${exists ? 'EXISTS' : 'NOT FOUND'}`);
});

// Serve static files from all possible paths
dashboardPaths.forEach(dashboardPath => {
    if (fs.existsSync(dashboardPath)) {
        app.use(express.static(dashboardPath));
    }
});

// Fallback: serve index.html for any route that isn't API or auth
app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        return res.status(404).send('Not Found');
    }

    for (const dashboardPath of dashboardPaths) {
        const indexPath = path.join(dashboardPath, 'index.html');
        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }
    }

    // If dashboard not found at all, show diagnostic
    res.status(404).send(`
        <html><body style="background:#0a0a1a;color:#e2e8f0;font-family:sans-serif;padding:40px;text-align:center;">
        <h1>Dashboard Not Found</h1>
        <p>Make sure <code>dashboard/build/index.html</code> exists in your project.</p>
        <p>Paths checked:</p>
        <ul style="text-align:left;display:inline-block;color:#94a3b8;font-size:13px;">
            ${dashboardPaths.map(p => `<li>${p} - ${fs.existsSync(p) ? 'EXISTS' : 'NOT FOUND'}</li>`).join('')}
        </ul>
        </body></html>
    `);
});

app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`سيرفر API يعمل على البورت ${API_PORT}`);
    console.log(`Dashboard URL: ${DASHBOARD_URL}`);
});

// Login to Discord
if (BOT_TOKEN) {
    client.login(BOT_TOKEN).catch(err => {
        console.error('فشل تسجيل الدخول:', err.message);
    });
} else {
    console.log('لم يتم توفير BOT_TOKEN. بانتظار طلبات API...');
}
