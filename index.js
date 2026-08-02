const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, Partials } = require('discord.js');
require('dotenv').config();
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
const API_PORT = process.env.PORT || process.env.API_PORT || 3000;
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

async function checkIfAdmin(discordUser, currentDb) {
    if (!discordUser) return false;
    
    // 1. Check if in serverAdmins list
    if (currentDb.serverAdmins && currentDb.serverAdmins.includes(discordUser.id)) return true;
    
    // 2. Check if user has Administrator permission in the guild
    if (currentDb.guildId) {
        try {
            const guild = client.guilds.cache.get(currentDb.guildId);
            if (guild) {
                const member = await guild.members.fetch(discordUser.id).catch(() => null);
                if (member && member.permissions.has(PermissionFlagsBits.Administrator)) return true;
            }
        } catch (err) {
            console.error('Error checking admin perms:', err.message);
        }
    }
    
    // 3. Check guilds list from OAuth if available
    if (discordUser.guilds && currentDb.guildId) {
        const guild = discordUser.guilds.find(g => g.id === currentDb.guildId);
        if (guild && (guild.permissions & 0x8)) return true; // 0x8 is ADMINISTRATOR
    }
    
    return false;
}

async function requireAdmin(req, res, next) {
    if (!req.session.discordUser) {
        return res.status(401).json({ error: 'غير مسجل دخول' });
    }
    const currentDb = loadDB();
    const isAdmin = await checkIfAdmin(req.session.discordUser, currentDb);

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
app.get('/api/config', requireAuth, async (req, res) => {
    const currentDb = loadDB();
    const userId = req.session.discordUser.id;
    const user = currentDb.users[userId] || { points: 0, pointsName: currentDb.defaultPointsName };
    const isAdmin = await checkIfAdmin(req.session.discordUser, currentDb);

    res.json({
        guildId: currentDb.guildId,
        pointsName: user.pointsName || currentDb.defaultPointsName,
        pointsPerMessage: currentDb.defaultPointsPerMessage,
        allowedChannels: currentDb.allowedChannels,
        logChannel: currentDb.logChannel,
        storeChannel: currentDb.storeChannel,
        serverAdmins: currentDb.serverAdmins,
        storeItems: currentDb.storeItems,
        totalUsers: Object.keys(currentDb.users).length,
        totalPoints: Object.values(currentDb.users).reduce((sum, u) => sum + (u.points || 0), 0),
        myPoints: user.points || 0,
        isAdmin: isAdmin
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
// SERVE DASHBOARD (Embedded HTML)
const htmlContent = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نظام النقاط - لوحة التحكم</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&display=swap"
        rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        :root {
            --primary: #7c3aed;
            --primary-light: #a78bfa;
            --primary-dark: #5b21b6;
            --secondary: #06b6d4;
            --accent: #f59e0b;
            --danger: #ef4444;
            --success: #10b981;
            --bg-dark: #0a0a1a;
            --bg-card: rgba(15, 15, 35, 0.85);
            --bg-glass: rgba(255, 255, 255, 0.05);
            --border: rgba(255, 255, 255, 0.1);
            --text: #e2e8f0;
            --text-muted: #94a3b8;
        }

        body {
            font-family: 'Tajawal', sans-serif;
            background: var(--bg-dark);
            color: var(--text);
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
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
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
                            <div class="stat-icon amber"><i class="fas fa-gem"></i></div>
                            <div class="stat-value" id="statTotalPoints">0</div>
                            <div class="stat-label">إجمالي النقاط</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon green"><i class="fas fa-store"></i></div>
                            <div class="stat-value" id="statStore">0</div>
                            <div class="stat-label">منتجات المتجر</div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title"><i class="fas fa-info-circle"></i> معلومات سريعة</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                            <div style="padding: 14px; background: var(--bg-glass); border-radius: 10px;">
                                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">اسم نقاطك
                                </div>
                                <div style="font-size: 18px; font-weight: 700;" id="infoMyPointsName">COIN</div>
                            </div>
                            <div style="padding: 14px; background: var(--bg-glass); border-radius: 10px;">
                                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">نقاط لكل
                                    رسالة</div>
                                <div style="font-size: 18px; font-weight: 700;" id="infoPointsPerMsg">1</div>
                            </div>
                            <div style="padding: 14px; background: var(--bg-glass); border-radius: 10px;">
                                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">القنوات
                                    المسموحة</div>
                                <div style="font-size: 18px; font-weight: 700;" id="infoChannels">0</div>
                            </div>
                            <div style="padding: 14px; background: var(--bg-glass); border-radius: 10px;">
                                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">قناة اللوغ
                                </div>
                                <div style="font-size: 18px; font-weight: 700;" id="infoLog">لم يتم تحديدها</div>
                            </div>
                        </div>
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
                config.pointsName = name;
                updateOverview();
                showToast('تم حفظ اسم النقاط!');
            } catch { showToast('فشل الحفظ!', 'error'); }
        }

        // Save server settings (admin)
        async function saveServerSettings() {
            const ppm = parseInt(document.getElementById('serverPointsPerMsg').value) || 0;
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pointsPerMessage: ppm })
                });
                config.pointsPerMessage = ppm;
                updateOverview();
                showToast('تم حفظ الإعدادات!');
            } catch { showToast('فشل الحفظ!', 'error'); }
        }

        // Channels
        function updateChannelSelects() {
            const sel = document.getElementById('allowedChannelsSelect');
            const logSel = document.getElementById('logChannelSelect');
            sel.innerHTML = '';
            logSel.innerHTML = '<option value="">-- اختر قناة اللوغ --</option>';

            channels.forEach(ch => {
                const item = document.createElement('div');
                item.className = 'multi-select-item' + ((config.allowedChannels || []).includes(ch.id) ? ' selected' : '');
                item.textContent = '#' + ch.name;
                item.onclick = () => {
                    item.classList.toggle('selected');
                    if (item.classList.contains('selected')) {
                        selectedChannels.push(ch.id);
                    } else {
                        selectedChannels = selectedChannels.filter(id => id !== ch.id);
                    }
                };
                sel.appendChild(item);

                const opt = document.createElement('option');
                opt.value = ch.id; opt.textContent = ch.name;
                logSel.appendChild(opt);
            });

            selectedChannels = [...(config.allowedChannels || [])];
            if (config.logChannel) logSel.value = config.logChannel;
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
            } catch { showToast('فشل الحفظ!', 'error'); }
        }

        async function saveLogChannel() {
            const lc = document.getElementById('logChannelSelect').value;
            try {
                await fetch(API_BASE + '/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ logChannel: lc })
                });
                config.logChannel = lc;
                updateOverview();
                showToast('تم حفظ قناة اللوغ!');
            } catch { showToast('فشل الحفظ!', 'error'); }
        }

        // Store
        function updateStoreItems(items) {
            const container = document.getElementById('storeItemsContainer');
            container.innerHTML = '';

            if (items.length === 0) {
                container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 40px;">لا توجد منتجات بالمتجر.</p>';
                return;
            }

            items.forEach((item, i) => {
                const card = document.createElement('div');
                card.className = 'store-item-card';
                card.style.animationDelay = (i * 0.1) + 's';
                card.innerHTML = \`
                    <div class="store-item-header">
                        <div class="store-item-name">\${item.name}</div>
                        <div class="store-item-price">\${item.price.toLocaleString()} نقطة</div>
                    </div>
                    <div class="store-item-desc">\${item.description || 'لا يوجد وصف'}</div>
                    \${item.roleId ? \`<div class="store-item-role"><i class="fas fa-crown"></i> رتبة: \${item.roleId}</div>\` : ''}
                    <div class="store-item-actions">
                        <button class="btn btn-secondary" onclick="showEditItemModal(\${item.id})">
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
            const roleOpts = roles.map(r => \`<option value="\${r.id}">\${r.name}</option>\`).join('');
            showModal(\`
                <div class="modal-title">إضافة منتج للمتجر</div>
                <div class="form-group">
                    <label class="form-label">اسم المنتج</label>
                    <input type="text" class="form-input" id="modalItemName" placeholder="مثال: VIP">
                </div>
                <div class="form-group">
                    <label class="form-label">السعر (بالنقاط)</label>
                    <input type="number" class="form-input" id="modalItemPrice" placeholder="مثال: 5000">
                </div>
                <div class="form-group">
                    <label class="form-label">التفاصيل / الوصف</label>
                    <input type="text" class="form-input" id="modalItemDesc" placeholder="اكتب تفاصيل المنتج...">
                </div>
                <div class="form-group">
                    <label class="form-label">رتبة ديسكورد (اختياري)</label>
                    <select class="form-select" id="modalItemRole">
                        <option value="">-- بدون رتبة --</option>
                        \${roleOpts}
                    </select>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="hideModal()">إلغاء</button>
                    <button class="btn btn-success" onclick="addItem()">
                        <i class="fas fa-plus"></i> إضافة
                    </button>
                </div>
            \`);
        }

        async function addItem() {
            const name = document.getElementById('modalItemName').value.trim();
            const price = parseInt(document.getElementById('modalItemPrice').value) || 0;
            const desc = document.getElementById('modalItemDesc').value.trim();
            const roleId = document.getElementById('modalItemRole').value || null;

            if (!name) { showToast('اسم المنتج مطلوب!', 'error'); return; }
            if (price <= 0) { showToast('السعر لازم يكون أكبر من 0!', 'error'); return; }

            try {
                await fetch(API_BASE + '/api/store', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, price, description: desc, roleId })
                });
                hideModal();
                fetchStoreItems();
                fetchConfig();
                showToast('تم إضافة المنتج!');
            } catch { showToast('فشل الإضافة!', 'error'); }
        }

        function showEditItemModal(itemId) {
            const item = config.storeItems.find(i => i.id === itemId);
            if (!item) return;
            const roleOpts = roles.map(r =>
                \`<option value="\${r.id}" \${r.id === item.roleId ? 'selected' : ''}>\${r.name}</option>\`
            ).join('');
            showModal(\`
                <div class="modal-title">تعديل المنتج</div>
                <div class="form-group">
                    <label class="form-label">اسم المنتج</label>
                    <input type="text" class="form-input" id="editName" value="\${item.name}">
                </div>
                <div class="form-group">
                    <label class="form-label">السعر</label>
                    <input type="number" class="form-input" id="editPrice" value="\${item.price}">
                </div>
                <div class="form-group">
                    <label class="form-label">التفاصيل</label>
                    <input type="text" class="form-input" id="editDesc" value="\${item.description || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">رتبة ديسكورد</label>
                    <select class="form-select" id="editRole">
                        <option value="">-- بدون رتبة --</option>
                        \${roleOpts}
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

</html>
`;

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(404).send('Not Found');
    res.send(htmlContent);
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
