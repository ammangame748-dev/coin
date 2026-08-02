const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits, Collection, Partials } = require('discord.js');
const express = require('express');
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
            pointsName: 'FBI',
            pointsPerMessage: 1,
            allowedChannels: [],
            logChannel: null,
            storeChannel: null,
            admins: [],
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

const cooldowns = new Map();

// ============================================================
// TOKEN & CONFIG
// ============================================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const API_PORT = process.env.API_PORT || 3001;
const GUILD_ID = process.env.GUILD_ID || '';

// If GUILD_ID is provided, set it as default
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
    const db2 = loadDB();
    let description = '';

    topUsers.forEach((entry, index) => {
        const rank = index + 1;
        description += `**${rank}.** <@${entry.userId}> , ${pointsName}  **${entry.points.toLocaleString()}** .\n`;
    });

    return new EmbedBuilder()
        .setColor('#ff6600')
        .setTitle(`${pointsName} Leaderboard`)
        .setDescription(description || '> No one has points yet.')
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

    // Give points per message
    if (db.pointsPerMessage && db.pointsPerMessage > 0) {
        const user = initUser(db, message.author.id, message.author.username);
        user.points = (user.points || 0) + db.pointsPerMessage;
        saveDB(db);
    }

    const content = message.content.trim();
    const pointsName = db.pointsName || 'FBI';
    const parts = content.split(/[\s]+/);
    const command = parts[0].toLowerCase();
    const prefixCommand = parts[0];

    // Points command (e.g., "FBI" or "fbi")
    if (prefixCommand.toLowerCase() === pointsName.toLowerCase()) {
        if (parts.length >= 3) {
            // Transfer: pointsName @user amount
            const mention = parts[1];
            const amount = parseInt(parts[2]);

            if (!mention.startsWith('<@') || !amount || amount <= 0) {
                return message.reply({ content: `> Use: ${pointsName} @user amount`, allowedMentions: { repliedUser: false } });
            }

            const targetUserId = mention.replace(/[^0-9]/g, '');
            const sender = initUser(db, message.author.id, message.author.username);
            let target = initUser(db, targetUserId, targetUserId);

            if (sender.points < amount) {
                return message.reply({ content: '> You do not have enough points.', allowedMentions: { repliedUser: false } });
            }

            sender.points -= amount;
            target.points = (target.points || 0) + amount;
            saveDB(db);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setDescription(`> **${message.author}** transferred **${amount.toLocaleString()}** ${pointsName} to **<@${targetUserId}>** .`)
                .setTimestamp();

            await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });

            // Log
            await sendLog(message.guild, 'Points Transfer', [
                { name: 'From', value: `<@${message.author.id}>`, inline: true },
                { name: 'To', value: `<@${targetUserId}>`, inline: true },
                { name: 'Amount', value: `${amount.toLocaleString()} ${pointsName}`, inline: true }
            ]);
            return;
        }

        // Just show points
        if (parts.length === 1) {
            const user = initUser(db, message.author.id, message.author.username);
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
            await message.reply({ content: '> No items available in the store.', allowedMentions: { repliedUser: false } });
            return;
        }

        const buttons = db.storeItems.map((item, index) => {
            return new ButtonBuilder()
                .setCustomId(`store_buy_${index}`)
                .setLabel(item.name)
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🛒');
        });

        const row = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        // If only 1-5 items, use first row
        if (rows.length === 0) {
            rows.push(row);
        }

        const embed = new EmbedBuilder()
            .setColor('#9b59b6')
            .setTitle('Store')
            .setDescription(db.storeItems.map((item, i) => `**${i + 1}.** ${item.name} - **${item.price.toLocaleString()}** ${pointsName}`).join('\n'))
            .setFooter({ text: 'Select an item to view details or purchase' });

        const msg = await message.reply({ embeds: [embed], components: rows, allowedMentions: { repliedUser: false } });
        return;
    }

    // STORE DETAILS command
    if (command === 'storedetails' || command === 'details') {
        if (!db.storeItems || db.storeItems.length === 0) {
            await message.reply({ content: '> No items available.', allowedMentions: { repliedUser: false } });
            return;
        }

        const buttons = db.storeItems.map((item, index) => {
            return new ButtonBuilder()
                .setCustomId(`store_details_${index}`)
                .setLabel(item.name)
                .setStyle(ButtonStyle.Secondary);
        });

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('Select an item to view details')
            .setDescription('Choose an item below to see its full details.');

        await message.reply({ embeds: [embed], components: rows, allowedMentions: { repliedUser: false } });
        return;
    }
});

// ============================================================
// BUTTON INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    // Store: Buy item
    if (customId.startsWith('store_buy_')) {
        const index = parseInt(customId.replace('store_buy_', ''));
        db = loadDB();

        if (!db.storeItems[index]) {
            await interaction.reply({ content: '> Item not found.', ephemeral: true });
            return;
        }

        const item = db.storeItems[index];
        const user = initUser(db, interaction.user.id, interaction.user.username);

        if (user.points < item.price) {
            await interaction.reply({
                content: `> You do not have enough points! You need **${item.price.toLocaleString()}** ${db.pointsName} but you only have **${(user.points || 0).toLocaleString()}** .`,
                ephemeral: true
            });
            return;
        }

        // Deduct points
        user.points -= item.price;
        saveDB(db);

        // Give role if roleId is set
        try {
            if (item.roleId) {
                const guild = client.guilds.cache.get(db.guildId);
                if (guild) {
                    const member = await guild.members.fetch(interaction.user.id);
                    if (member && item.roleId) {
                        await member.roles.add(item.roleId);
                    }
                }
            }
        } catch (err) {
            console.error('Role add error:', err.message);
        }

        // Confirm buttons
        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`store_confirm_buy_${index}`)
                .setLabel('Buy Now')
                .setStyle(ButtonStyle.Success)
        );

        const confirmEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle(`Purchase: ${item.name}`)
            .setDescription(`> **Price:** ${item.price.toLocaleString()} ${db.pointsName}\n> **Your balance:** ${(user.points || 0).toLocaleString()} ${db.pointsName}\n> Do you want to purchase **${item.name}**?`)
            .setTimestamp();

        await interaction.reply({ embeds: [confirmEmbed], components: [confirmRow], ephemeral: true });
        return;
    }

    // Store: Confirm buy
    if (customId.startsWith('store_confirm_buy_')) {
        const index = parseInt(customId.replace('store_confirm_buy_', ''));
        db = loadDB();

        if (!db.storeItems[index]) {
            await interaction.update({ content: '> Item not found.', embeds: [], components: [], ephemeral: true });
            return;
        }

        const item = db.storeItems[index];
        const user = db.users[interaction.user.id];

        if (!user || (user.points || 0) < item.price) {
            await interaction.update({
                content: '> You do not have enough points to complete this purchase.',
                embeds: [], components: [], ephemeral: true
            });
            return;
        }

        // Final deduction
        user.points -= item.price;
        saveDB(db);

        // Give role
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
            .setTitle('Purchase Successful!')
            .setDescription(`> You successfully purchased **${item.name}** !\n> Remaining balance: **${(user.points || 0).toLocaleString()}** ${db.pointsName}`)
            .setTimestamp();

        await interaction.update({ embeds: [successEmbed], components: [], ephemeral: true });

        // Log
        const guild = client.guilds.cache.get(db.guildId);
        await sendLog(guild, 'Store Purchase', [
            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Item', value: item.name, inline: true },
            { name: 'Price', value: `${item.price.toLocaleString()} ${db.pointsName}`, inline: true }
        ]);
        return;
    }

    // Store: Details
    if (customId.startsWith('store_details_')) {
        const index = parseInt(customId.replace('store_details_', ''));
        db = loadDB();

        if (!db.storeItems[index]) {
            await interaction.reply({ content: '> Item not found.', ephemeral: true });
            return;
        }

        const item = db.storeItems[index];

        const detailsRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`store_buy_${index}`)
                .setLabel('Buy Now')
                .setStyle(ButtonStyle.Success)
        );

        const detailsEmbed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle(item.name)
            .setDescription(item.description || '> No description available.')
            .addFields(
                { name: 'Price', value: `**${item.price.toLocaleString()}** ${db.pointsName}`, inline: true },
                { name: 'Role', value: item.roleId ? '<@&' + item.roleId + '>' : 'None', inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [detailsEmbed], components: [detailsRow], ephemeral: true });
        return;
    }

    // Slash Commands
    if (interaction.isChatInputCommand()) {
        const command = interaction.commandName;
        db = loadDB();

        // Check admin
        const isAdmin = db.admins.includes(interaction.user.id) ||
            (interaction.member && interaction.member.permissions.has(PermissionFlagsBits.Administrator));

        if (!isAdmin) {
            await interaction.reply({ content: '> You do not have permission to use this command.', ephemeral: true });
            return;
        }

        if (command === 'addpoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const guild = client.guilds.cache.get(db.guildId);

            const user = initUser(db, target.id, target.username);
            user.points = (user.points || 0) + amount;
            saveDB(db);

            await interaction.reply({ content: `> Successfully added **${amount.toLocaleString()}** ${db.pointsName} to <@${target.id}> . New balance: **${user.points.toLocaleString()}** .` });

            await sendLog(guild, 'Points Added', [
                { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${target.id}>`, inline: true },
                { name: 'Amount', value: `+${amount.toLocaleString()} ${db.pointsName}`, inline: true }
            ]);
        }

        if (command === 'removepoints') {
            const target = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            const guild = client.guilds.cache.get(db.guildId);

            const user = initUser(db, target.id, target.username);
            user.points = Math.max(0, (user.points || 0) - amount);
            saveDB(db);

            await interaction.reply({ content: `> Successfully removed **${amount.toLocaleString()}** ${db.pointsName} from <@${target.id}> . New balance: **${user.points.toLocaleString()}** .` });

            await sendLog(guild, 'Points Removed', [
                { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${target.id}>`, inline: true },
                { name: 'Amount', value: `-${amount.toLocaleString()} ${db.pointsName}`, inline: true }
            ]);
        }

        if (command === 'resetpoints') {
            const guild = client.guilds.cache.get(db.guildId);

            // Reset all users
            for (const userId in db.users) {
                db.users[userId].points = 0;
            }
            saveDB(db);

            await interaction.reply({ content: `> All points have been reset successfully.` });

            await sendLog(guild, 'Points Reset', [
                { name: 'Admin', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Action', value: 'All points reset to 0', inline: false }
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
        .setDescription('Add points to a user (Admin only)')
        .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('removepoints')
        .setDescription('Remove points from a user (Admin only)')
        .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to remove').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('resetpoints')
        .setDescription('Reset all points (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

async function registerCommands() {
    try {
        const guild = client.guilds.cache.get(db.guildId);
        if (guild) {
            await guild.commands.set(slashCommands);
            console.log('Slash commands registered!');
        } else {
            console.log('No guild found to register commands. Will register when bot joins a guild.');
        }
    } catch (err) {
        console.error('Error registering commands:', err.message);
    }
}

client.on('ready', () => {
    console.log(`Bot is online as ${client.user.tag}`);
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
// API SERVER (for Dashboard)
// ============================================================
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Get config
app.get('/api/config', (req, res) => {
    db = loadDB();
    res.json({
        guildId: db.guildId,
        pointsName: db.pointsName,
        pointsPerMessage: db.pointsPerMessage,
        allowedChannels: db.allowedChannels,
        logChannel: db.logChannel,
        storeChannel: db.storeChannel,
        admins: db.admins,
        storeItems: db.storeItems,
        totalUsers: Object.keys(db.users).length,
        totalPoints: Object.values(db.users).reduce((sum, u) => sum + (u.points || 0), 0)
    });
});

// Update config
app.post('/api/config', (req, res) => {
    db = loadDB();
    const { pointsName, pointsPerMessage, allowedChannels, logChannel, storeChannel, admins } = req.body;

    if (pointsName !== undefined) db.pointsName = pointsName;
    if (pointsPerMessage !== undefined) db.pointsPerMessage = pointsPerMessage;
    if (allowedChannels !== undefined) db.allowedChannels = allowedChannels;
    if (logChannel !== undefined) db.logChannel = logChannel;
    if (storeChannel !== undefined) db.storeChannel = storeChannel;
    if (admins !== undefined) db.admins = admins;

    saveDB(db);
    res.json({ success: true });
});

// Store items management
app.get('/api/store', (req, res) => {
    db = loadDB();
    res.json(db.storeItems || []);
});

app.post('/api/store', (req, res) => {
    db = loadDB();
    const { name, price, description, roleId } = req.body;

    if (!db.storeItems) db.storeItems = [];

    db.storeItems.push({
        name: name || 'Untitled',
        price: price || 0,
        description: description || '',
        roleId: roleId || null,
        id: Date.now()
    });

    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

app.put('/api/store/:id', (req, res) => {
    db = loadDB();
    const itemId = parseInt(req.params.id);
    const index = db.storeItems.findIndex(item => item.id === itemId);

    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    const { name, price, description, roleId } = req.body;
    if (name !== undefined) db.storeItems[index].name = name;
    if (price !== undefined) db.storeItems[index].price = price;
    if (description !== undefined) db.storeItems[index].description = description;
    if (roleId !== undefined) db.storeItems[index].roleId = roleId;

    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

app.delete('/api/store/:id', (req, res) => {
    db = loadDB();
    const itemId = parseInt(req.params.id);
    db.storeItems = db.storeItems.filter(item => item.id !== itemId);
    saveDB(db);
    res.json({ success: true, storeItems: db.storeItems });
});

// Get users list
app.get('/api/users', (req, res) => {
    db = loadDB();
    const users = Object.entries(db.users)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (b.points || 0) - (a.points || 0));
    res.json(users);
});

// Add/remove points via API
app.post('/api/addpoints', (req, res) => {
    db = loadDB();
    const { userId, amount } = req.body;
    const user = initUser(db, userId, userId);
    user.points = (user.points || 0) + amount;
    saveDB(db);
    res.json({ success: true, newBalance: user.points });
});

app.post('/api/removepoints', (req, res) => {
    db = loadDB();
    const { userId, amount } = req.body;
    const user = initUser(db, userId, userId);
    user.points = Math.max(0, (user.points || 0) - amount);
    saveDB(db);
    res.json({ success: true, newBalance: user.points });
});

// Reset all points via API
app.post('/api/reset', (req, res) => {
    db = loadDB();
    for (const userId in db.users) {
        db.users[userId].points = 0;
    }
    saveDB(db);
    res.json({ success: true });
});

// Get guild channels
app.get('/api/channels', async (req, res) => {
    try {
        db = loadDB();
        const guild = client.guilds.cache.get(db.guildId);
        if (!guild) return res.json([]);

        await guild.fetch();
        const channels = guild.channels.cache
            .filter(c => c.type === 0) // Text channels only
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(channels);
    } catch (err) {
        res.json([]);
    }
});

// Get guild roles
app.get('/api/roles', async (req, res) => {
    try {
        db = loadDB();
        const guild = client.guilds.cache.get(db.guildId);
        if (!guild) return res.json([]);

        await guild.fetch();
        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id) // Filter out @everyone
            .map(r => ({ id: r.id, name: r.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(roles);
    } catch (err) {
        res.json([]);
    }
});

// Get guild members (for admin selection)
app.get('/api/members', async (req, res) => {
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

// Static files for dashboard
app.use(express.static(path.join(__dirname, '..', 'dashboard', 'build')));

app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`API server running on port ${API_PORT}`);
});

// Login to Discord
if (BOT_TOKEN) {
    client.login(BOT_TOKEN).catch(err => {
        console.error('Failed to login:', err.message);
    });
} else {
    console.log('No BOT_TOKEN provided. Waiting for API requests...');
}
