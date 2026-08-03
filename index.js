/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          🛡️  WANO SECURITY BOT — Ultimate Discord Guard          ║
 * ║                  © 2026 مروان | Wano Studio                      ║
 * ║         Discord: @wn6b | GitHub: @wn5b | TikTok: @w_n6b          ║
 * ║         يُمنع إعادة البيع أو التوزيع أو حذف هذا الملف            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  البوت: Wano Security Bot v4.0
 *  المطور: مروان (Wano) — Wano Studio
 *  الوصف: أقوى بوت حماية على ديسكورد — Slash Commands Edition
 *  الحقوق: By @.om_.
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  Collection,
  AuditLogEvent,
  ChannelType,
  Colors,
  ApplicationCommandOptionType,
} = require("discord.js");

const fs   = require("fs");
const path = require("path");
require("dotenv").config();

// ══════════════════════════════════════════
//            CLIENT SETUP
// ══════════════════════════════════════════

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.GuildMember,
    Partials.User,
  ],
});

client.commands = new Collection();
client.cooldowns = new Collection();

// ══════════════════════════════════════════
//            DATABASE (JSON)
// ══════════════════════════════════════════

const DB_PATH = "./db";
if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH);

function loadDB(name) {
  const file = path.join(DB_PATH, `${name}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({}));
  return JSON.parse(fs.readFileSync(file));
}

function saveDB(name, data) {
  const file = path.join(DB_PATH, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ══════════════════════════════════════════
//            CONFIG DEFAULTS
// ══════════════════════════════════════════

const defaultConfig = {
  logChannel: null,
  modLogChannel: null,
  muteRole: null,
  verifyRole: null,
  antiSpam: true,
  antiRaid: true,
  antiNuke: true,
  antiLinks: false,
  antiInvites: false,
  antiMassMention: true,
  antiCaps: false,
  antiEmoji: false,
  antiWords: [],
  maxWarns: 3,
  warnAction: "mute",
  antiBotAdd: false,
  antiWebhook: false,
  autoRole: null,
  joinGate: false,
  lockdownMode: false,
  whitelistedBots: [],
  whitelistedUsers: [],
  slowmode: 0,
  captchaVerify: false,
  ghostPing: true,
  newAccountThreshold: 7,
  panicMode: false,
};

// ══════════════════════════════════════════
//        UTILITY FUNCTIONS
// ══════════════════════════════════════════

function getConfig(guildId) {
  const configs = loadDB("configs");
  return { ...defaultConfig, ...(configs[guildId] || {}) };
}

function setConfig(guildId, key, value) {
  const configs = loadDB("configs");
  if (!configs[guildId]) configs[guildId] = {};
  configs[guildId][key] = value;
  saveDB("configs", configs);
}

function getWarns(guildId, userId) {
  const warns = loadDB("warns");
  return warns[`${guildId}_${userId}`] || [];
}

function addWarn(guildId, userId, reason, modId) {
  const warns = loadDB("warns");
  const key = `${guildId}_${userId}`;
  if (!warns[key]) warns[key] = [];
  warns[key].push({ reason, modId, time: Date.now() });
  saveDB("warns", warns);
  return warns[key];
}

function clearWarns(guildId, userId) {
  const warns = loadDB("warns");
  const key = `${guildId}_${userId}`;
  warns[key] = [];
  saveDB("warns", warns);
}

function getMutes(guildId) {
  const mutes = loadDB("mutes");
  return mutes[guildId] || {};
}

function addMute(guildId, userId, endsAt, reason) {
  const mutes = loadDB("mutes");
  if (!mutes[guildId]) mutes[guildId] = {};
  mutes[guildId][userId] = { endsAt, reason };
  saveDB("mutes", mutes);
}

function removeMute(guildId, userId) {
  const mutes = loadDB("mutes");
  if (mutes[guildId]) delete mutes[guildId][userId];
  saveDB("mutes", mutes);
}

function getNotes(guildId, userId) {
  const notes = loadDB("notes");
  return notes[`${guildId}_${userId}`] || [];
}

function addNote(guildId, userId, note, modId) {
  const notes = loadDB("notes");
  const key = `${guildId}_${userId}`;
  if (!notes[key]) notes[key] = [];
  notes[key].push({ note, modId, time: Date.now() });
  saveDB("notes", notes);
}

function getBlacklist(guildId) {
  const bl = loadDB("blacklist");
  return bl[guildId] || { words: [], domains: [], users: [] };
}

function addBlacklistWord(guildId, word) {
  const bl = loadDB("blacklist");
  if (!bl[guildId]) bl[guildId] = { words: [], domains: [], users: [] };
  if (!bl[guildId].words.includes(word)) bl[guildId].words.push(word);
  saveDB("blacklist", bl);
}

function removeBlacklistWord(guildId, word) {
  const bl = loadDB("blacklist");
  if (!bl[guildId]) return;
  bl[guildId].words = bl[guildId].words.filter((w) => w !== word);
  saveDB("blacklist", bl);
}

function getRaidLog(guildId) {
  const rl = loadDB("raidlog");
  return rl[guildId] || [];
}

function logRaid(guildId, userId) {
  const rl = loadDB("raidlog");
  if (!rl[guildId]) rl[guildId] = [];
  rl[guildId].push({ userId, time: Date.now() });
  if (rl[guildId].length > 500) rl[guildId] = rl[guildId].slice(-500);
  saveDB("raidlog", rl);
}

function getLocked(guildId) {
  const lock = loadDB("locked");
  return lock[guildId] || [];
}

function setLocked(guildId, channels) {
  const lock = loadDB("locked");
  lock[guildId] = channels;
  saveDB("locked", lock);
}

function getPanicMode(guildId) {
  const panic = loadDB("panic");
  return panic[guildId] || false;
}

function setPanicMode(guildId, val) {
  const panic = loadDB("panic");
  panic[guildId] = val;
  saveDB("panic", panic);
}

// ══════════════════════════════════════════
//        SPAM & RAID TRACKING
// ══════════════════════════════════════════

const spamTracker    = new Map();
const raidTracker    = new Map();
const mentionTracker = new Map();
const ghostPingCache = new Map();

// ══════════════════════════════════════════
//   ✦ WANO EMBED SYSTEM — أشكال جديدة كلياً
// ══════════════════════════════════════════

const CREDITS = "\n\n─────────────────────\n**By @.om_.**";

/**
 * الإيمبد الرئيسي — إطار مزدوج بألوان متدرجة
 */
function wanoEmbed(title, description, color = 0xE84141) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: "⬡ WANO SECURITY SYSTEM",
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTitle(`${title}`)
    .setDescription(`${description}${CREDITS}`)
    .setFooter({ text: "🛡️ Wano Security · مروان | Wano Studio · @wn6b", iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();
}

/**
 * إيمبد النجاح — شريط جانبي أخضر + هيدر مختلف
 */
function successEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0x00E676)
    .setAuthor({ name: "✦ ACTION COMPLETED", iconURL: client.user?.displayAvatarURL() })
    .setTitle(`<:check:✅>  ${title}`)
    .setDescription(
      `\`\`\`diff\n+ ${desc.replace(/\n/g, "\n+ ")}\n\`\`\`` +
      `${CREDITS}`
    )
    .setFooter({ text: "🛡️ Wano Security · @wn6b" })
    .setTimestamp();
}

/**
 * إيمبد الخطأ — ستايل ريد alert
 */
function errorEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0xFF1744)
    .setAuthor({ name: "✖ ERROR DETECTED", iconURL: client.user?.displayAvatarURL() })
    .setTitle(`⛔  ${title}`)
    .setDescription(
      `> ⚠️ **${desc}**` + `${CREDITS}`
    )
    .setFooter({ text: "🛡️ Wano Security · @wn6b" })
    .setTimestamp();
}

/**
 * إيمبد التحذير — كود بلوك أصفر
 */
function warnEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0xFFD600)
    .setAuthor({ name: "⚡ WARNING ISSUED", iconURL: client.user?.displayAvatarURL() })
    .setTitle(`⚠️  ${title}`)
    .setDescription(
      `\`\`\`fix\n${desc}\n\`\`\`` + `${CREDITS}`
    )
    .setFooter({ text: "🛡️ Wano Security · @wn6b" })
    .setTimestamp();
}

/**
 * إيمبد المعلومات — ستايل terminal/log
 */
function infoEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(0x29B6F6)
    .setAuthor({ name: "◈ INFO PANEL", iconURL: client.user?.displayAvatarURL() })
    .setTitle(`📋  ${title}`)
    .setDescription(desc + `${CREDITS}`)
    .setFooter({ text: "🛡️ Wano Security · @wn6b" })
    .setTimestamp();
}

/**
 * إيمبد اللوج — أسلوب سجل أحداث
 */
function logEmbed(type, color, fields) {
  const icons = {
    BAN: "🔨", KICK: "👢", MUTE: "🔇", UNMUTE: "🔊",
    WARN: "⚠️", PURGE: "🗑️", LOCK: "🔒", UNLOCK: "🔓",
    RAID: "🚨", NUKE: "💥", SPAM: "⚡", GHOST: "👻",
    JOIN: "📥", LEAVE: "📤", EDIT: "✏️", DELETE: "🗑️",
    BOT: "🤖", WEBHOOK: "🕸️", PANIC: "🆘",
  };
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `${icons[type] || "📌"} ${type} LOG — Wano Security`, iconURL: client.user?.displayAvatarURL() })
    .setTimestamp()
    .setFooter({ text: `By @.om_. · Wano Studio` });
  for (const f of fields) {
    embed.addFields({ name: f.name, value: f.value, inline: f.inline ?? true });
  }
  return embed;
}

/**
 * إيمبد الحماية — ستايل threat alert
 */
function threatEmbed(title, desc, level = "HIGH") {
  const levels = {
    LOW:    { color: 0xFFD600, bar: "🟡🟡⬜⬜⬜" },
    MEDIUM: { color: 0xFF6D00, bar: "🟠🟠🟠⬜⬜" },
    HIGH:   { color: 0xFF1744, bar: "🔴🔴🔴🔴⬜" },
    PANIC:  { color: 0xFF0000, bar: "🔴🔴🔴🔴🔴" },
  };
  const l = levels[level] || levels.HIGH;
  return new EmbedBuilder()
    .setColor(l.color)
    .setAuthor({ name: "🛡️ THREAT ALERT — WANO SECURITY", iconURL: client.user?.displayAvatarURL() })
    .setTitle(`⛔ ${title}`)
    .setDescription(
      `\`\`\`ansi\n\u001b[1;31m[ALERT]\u001b[0m ${desc}\n\`\`\`` +
      `**Threat Level:** ${l.bar} \`${level}\`` +
      `${CREDITS}`
    )
    .setFooter({ text: "🛡️ Wano Security · Real-Time Protection" })
    .setTimestamp();
}

async function sendLog(guild, embed) {
  const config = getConfig(guild.id);
  const chId   = config.logChannel || config.modLogChannel;
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

async function sendModLog(guild, embed) {
  const config = getConfig(guild.id);
  const chId   = config.modLogChannel || config.logChannel;
  if (!chId) return;
  const ch = guild.channels.cache.get(chId);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

// ══════════════════════════════════════════
//         CHECK PERMISSIONS
// ══════════════════════════════════════════

function isMod(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// ══════════════════════════════════════════
//        ANTI-SPAM ENGINE
// ══════════════════════════════════════════

const SPAM_LIMIT  = 5;
const SPAM_WINDOW = 5000;

async function checkSpam(message) {
  const config = getConfig(message.guild.id);
  if (!config.antiSpam) return false;
  if (isMod(message.member)) return false;

  const userId = message.author.id;
  const now    = Date.now();

  if (!spamTracker.has(userId)) spamTracker.set(userId, { msgs: [], warns: 0 });
  const data = spamTracker.get(userId);
  data.msgs  = data.msgs.filter((t) => now - t < SPAM_WINDOW);
  data.msgs.push(now);

  if (data.msgs.length >= SPAM_LIMIT) {
    data.msgs = [];
    data.warns++;
    const msgs = await message.channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (msgs) {
      const toDelete = msgs.filter((m) => m.author.id === userId && now - m.createdTimestamp < 10000);
      message.channel.bulkDelete(toDelete).catch(() => {});
    }

    if (data.warns >= 3) {
      const muteRole = config.muteRole ? message.guild.roles.cache.get(config.muteRole) : null;
      if (muteRole) message.member.roles.add(muteRole).catch(() => {});
      else await message.member.timeout(10 * 60 * 1000, "سبام متكرر").catch(() => {});
      const embed = threatEmbed(
        "تم كتم العضو تلقائياً",
        `المستخدم: ${message.author.tag}\nالسبب: سبام متكرر (3x)\nالوقت: <t:${Math.floor(now / 1000)}:R>`,
        "HIGH"
      );
      sendLog(message.guild, embed);
      message.channel.send({ embeds: [embed] }).then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
      data.warns = 0;
    } else {
      message.channel.send({
        embeds: [warnEmbed("تحذير سبام", `${message.author} توقف! تحذير #${data.warns}/3`)],
      }).then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    }
    return true;
  }
  return false;
}

// ══════════════════════════════════════════
//        ANTI-RAID ENGINE
// ══════════════════════════════════════════

const RAID_THRESHOLD = 10;
const RAID_WINDOW    = 10000;

async function checkRaid(member) {
  const config  = getConfig(member.guild.id);
  if (!config.antiRaid) return false;

  const guildId = member.guild.id;
  const now     = Date.now();

  if (!raidTracker.has(guildId)) raidTracker.set(guildId, { joins: [] });
  const data = raidTracker.get(guildId);
  data.joins = data.joins.filter((t) => now - t < RAID_WINDOW);
  data.joins.push(now);
  logRaid(guildId, member.id);

  if (data.joins.length >= RAID_THRESHOLD) {
    data.joins = [];
    if (!getPanicMode(guildId)) {
      setPanicMode(guildId, true);
      const embed = threatEmbed(
        "RAID DETECTED — وضع الطوارئ مُفعّل",
        `${RAID_THRESHOLD}+ انضمامات في أقل من 10 ثواني!\nتم تفعيل وضع الطوارئ وقفل جميع القنوات.`,
        "PANIC"
      );
      sendLog(member.guild, embed);
      member.guild.channels.cache
        .filter((c) => c.type === ChannelType.GuildText)
        .forEach((ch) => ch.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(() => {}));
    }
    return true;
  }
  return false;
}

// ══════════════════════════════════════════
//     ANTI-MASS MENTION ENGINE
// ══════════════════════════════════════════

async function checkMassMention(message) {
  const config   = getConfig(message.guild.id);
  if (!config.antiMassMention) return false;
  if (isMod(message.member)) return false;

  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions >= 5) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("منشن جماعي محظور", `${message.author} لا يُسمح بذكر أكثر من 5 في رسالة.`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
    addWarn(message.guild.id, message.author.id, "منشن جماعي", client.user.id);
    sendLog(message.guild, logEmbed("WARN", 0xFFD600, [
      { name: "المستخدم", value: message.author.tag },
      { name: "المنشنات", value: `${mentions}` },
      { name: "القناة", value: `${message.channel}` },
    ]));
    return true;
  }
  return false;
}

// ══════════════════════════════════════════
//     ANTI-CAPS / ANTI-EMOJI / ANTI-LINKS
// ══════════════════════════════════════════

async function checkCaps(message) {
  const config = getConfig(message.guild.id);
  if (!config.antiCaps || isMod(message.member) || message.content.length < 10) return false;
  const upperCount = message.content.replace(/[^A-Z]/g, "").length;
  if (upperCount / message.content.length > 0.7) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("Caps Lock محظور", `${message.author} لا تكتب بأحرف كبيرة مبالغ فيها.`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    return true;
  }
  return false;
}

async function checkEmojiSpam(message) {
  const config = getConfig(message.guild.id);
  if (!config.antiEmoji || isMod(message.member)) return false;
  const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]|<a?:\w+:\d+>)/g;
  const matches = message.content.match(emojiRegex) || [];
  if (matches.length > 10) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("سبام إيموجي", `${message.author} لا تستخدم أكثر من 10 إيموجي!`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    return true;
  }
  return false;
}

const linkRegex   = /(https?:\/\/[^\s]+)/gi;
const inviteRegex = /(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;

async function checkLinks(message) {
  const config    = getConfig(message.guild.id);
  if (isMod(message.member)) return false;
  const hasLink   = linkRegex.test(message.content);
  const hasInvite = inviteRegex.test(message.content);

  if (config.antiInvites && hasInvite) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("دعوات محظورة", `${message.author} لا يُسمح بمشاركة دعوات ديسكورد.`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    addWarn(message.guild.id, message.author.id, "نشر دعوة ديسكورد", client.user.id);
    return true;
  }
  if (config.antiLinks && hasLink && !hasInvite) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("روابط محظورة", `${message.author} إرسال الروابط محظور.`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    return true;
  }
  return false;
}

async function checkBlacklist(message) {
  const bl = getBlacklist(message.guild.id);
  if (!bl.words.length || isMod(message.member)) return false;
  const content = message.content.toLowerCase();
  const found   = bl.words.find((w) => content.includes(w.toLowerCase()));
  if (found) {
    message.delete().catch(() => {});
    message.channel.send({ embeds: [warnEmbed("كلمة محظورة", `${message.author} تم حذف رسالتك.`)] })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 4000));
    addWarn(message.guild.id, message.author.id, "كلمة محظورة", client.user.id);
    sendLog(message.guild, logEmbed("WARN", 0xFF1744, [
      { name: "المستخدم", value: message.author.tag },
      { name: "الكلمة", value: `\`${found}\`` },
      { name: "القناة", value: `${message.channel}` },
    ]));
    return true;
  }
  return false;
}

// ══════════════════════════════════════════
//     ANTI-NUKE ENGINE
// ══════════════════════════════════════════

const nukeTracker = new Map();
const NUKE_WINDOW = 10000;
const NUKE_THRESHOLDS = { channelDeletes: 3, bans: 5, kicks: 5, roleGives: 5, webhookCreates: 3 };

function trackNukeAction(guildId, userId, action) {
  const key = `${guildId}_${userId}`;
  const now = Date.now();
  if (!nukeTracker.has(key)) nukeTracker.set(key, {});
  const data = nukeTracker.get(key);
  if (!data[action]) data[action] = [];
  data[action] = data[action].filter((t) => now - t < NUKE_WINDOW);
  data[action].push(now);
  return data[action].length;
}

async function handleNukeAttempt(guild, userId, action, count) {
  const threshold = NUKE_THRESHOLDS[action];
  if (count < threshold) return;
  const config = getConfig(guild.id);
  const member = guild.members.cache.get(userId);
  if (!member) return;
  if (isAdmin(member) && config.whitelistedUsers.includes(userId)) return;

  guild.members.ban(userId, { reason: "🛡️ Wano AntiNuke — نشاط مشبوه" }).catch(() => {});
  sendLog(guild, threatEmbed(
    "NUKE ATTEMPT BLOCKED",
    `المستخدم: ${member.user.tag} (${userId})\nالإجراء: ${action}\nالعدد: ${count} مرة في 10 ثواني\n✅ تم باندم المستخدم تلقائياً`,
    "PANIC"
  ));
}

// ══════════════════════════════════════════
//        SLASH COMMANDS DEFINITIONS
// ══════════════════════════════════════════

const slashCommands = [

  // ═══ MODERATION ═══
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("حظر عضو من السيرفر")
    .addUserOption(o => o.setName("المستخدم").setDescription("المستخدم المراد حظره").setRequired(true))
    .addStringOption(o => o.setName("السبب").setDescription("سبب الحظر").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("رفع حظر مستخدم")
    .addStringOption(o => o.setName("id").setDescription("ID المستخدم").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("طرد عضو من السيرفر")
    .addUserOption(o => o.setName("المستخدم").setDescription("المستخدم المراد طرده").setRequired(true))
    .addStringOption(o => o.setName("السبب").setDescription("سبب الطرد").setRequired(false)),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("كتم عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addIntegerOption(o => o.setName("المدة").setDescription("المدة بالدقائق").setRequired(false).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("السبب").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("رفع كتم عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("تحذير عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("السبب").setDescription("السبب").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warns")
    .setDescription("عرض تحذيرات عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(false)),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("مسح تحذيرات عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("حذف رسائل من القناة")
    .addIntegerOption(o => o.setName("العدد").setDescription("عدد الرسائل (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("purgeuser")
    .setDescription("حذف رسائل مستخدم معين")
    .addUserOption(o => o.setName("المستخدم").setDescription("المستخدم").setRequired(true))
    .addIntegerOption(o => o.setName("العدد").setDescription("العدد").setRequired(false).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("توقيت عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addIntegerOption(o => o.setName("الدقائق").setDescription("المدة بالدقائق").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("السبب").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("رفع توقيت عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true)),

  new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban — طرد مع حذف الرسائل")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("السبب").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("massban")
    .setDescription("باند جماعي بأيدي متعددة")
    .addStringOption(o => o.setName("ids").setDescription("الأيدي مفصولة بمسافات").setRequired(true)),

  new SlashCommandBuilder()
    .setName("banlist")
    .setDescription("عرض قائمة المحظورين"),

  new SlashCommandBuilder()
    .setName("note")
    .setDescription("إضافة ملاحظة على عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("الملاحظة").setDescription("النص").setRequired(true)),

  new SlashCommandBuilder()
    .setName("notes")
    .setDescription("عرض ملاحظات عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nick")
    .setDescription("تغيير كنية عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("الكنية").setDescription("الكنية الجديدة (اتركه فارغاً للإعادة)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("إضافة/إزالة دور من عضو")
    .addStringOption(o => o.setName("الإجراء").setDescription("add أو remove").setRequired(true)
      .addChoices({ name: "إضافة", value: "add" }, { name: "إزالة", value: "remove" }))
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addRoleOption(o => o.setName("الدور").setDescription("الدور").setRequired(true)),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("تعيين السلو مود")
    .addIntegerOption(o => o.setName("الثواني").setDescription("المدة بالثواني (0 للإيقاف)").setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("قفل القناة الحالية")
    .addStringOption(o => o.setName("السبب").setDescription("السبب").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("فتح القناة الحالية"),

  new SlashCommandBuilder()
    .setName("lockall")
    .setDescription("قفل جميع القنوات"),

  new SlashCommandBuilder()
    .setName("unlockall")
    .setDescription("فتح جميع القنوات"),

  // ═══ BLACKLIST / WHITELIST ═══
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("إدارة القائمة السوداء")
    .addStringOption(o => o.setName("الإجراء").setDescription("add / remove / list").setRequired(true)
      .addChoices({ name: "إضافة", value: "add" }, { name: "إزالة", value: "remove" }, { name: "عرض", value: "list" }))
    .addStringOption(o => o.setName("الكلمة").setDescription("الكلمة المراد إضافتها/إزالتها").setRequired(false)),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("إدارة القائمة البيضاء")
    .addStringOption(o => o.setName("الإجراء").setDescription("add / remove / list").setRequired(true)
      .addChoices({ name: "إضافة", value: "add" }, { name: "إزالة", value: "remove" }, { name: "عرض", value: "list" }))
    .addUserOption(o => o.setName("المستخدم").setDescription("المستخدم").setRequired(false)),

  // ═══ CONFIG ═══
  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("تعيين قناة السجلات")
    .addChannelOption(o => o.setName("القناة").setDescription("القناة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setmodlog")
    .setDescription("تعيين قناة سجلات المود")
    .addChannelOption(o => o.setName("القناة").setDescription("القناة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setmuterole")
    .setDescription("تعيين دور الكتم")
    .addRoleOption(o => o.setName("الدور").setDescription("الدور").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setautorole")
    .setDescription("تعيين الأوتورول")
    .addRoleOption(o => o.setName("الدور").setDescription("الدور").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setmaxwarns")
    .setDescription("تعيين الحد الأقصى للتحذيرات")
    .addIntegerOption(o => o.setName("العدد").setDescription("العدد").setRequired(true).setMinValue(1).setMaxValue(20)),

  new SlashCommandBuilder()
    .setName("setwarnaction")
    .setDescription("تعيين إجراء التحذيرات")
    .addStringOption(o => o.setName("الإجراء").setDescription("mute / kick / ban").setRequired(true)
      .addChoices({ name: "كتم", value: "mute" }, { name: "طرد", value: "kick" }, { name: "حظر", value: "ban" })),

  // ═══ TOGGLES ═══
  new SlashCommandBuilder().setName("antispam").setDescription("تفعيل/تعطيل الحماية من السبام"),
  new SlashCommandBuilder().setName("antiraid").setDescription("تفعيل/تعطيل الحماية من الريد"),
  new SlashCommandBuilder().setName("antinuke").setDescription("تفعيل/تعطيل الحماية من النيوك"),
  new SlashCommandBuilder().setName("antilinks").setDescription("تفعيل/تعطيل حظر الروابط"),
  new SlashCommandBuilder().setName("antiinvites").setDescription("تفعيل/تعطيل حظر الدعوات"),
  new SlashCommandBuilder().setName("antimassmention").setDescription("تفعيل/تعطيل حظر الماس منشن"),
  new SlashCommandBuilder().setName("anticaps").setDescription("تفعيل/تعطيل حظر الكابس لوك"),
  new SlashCommandBuilder().setName("antiemoji").setDescription("تفعيل/تعطيل حظر سبام الإيموجي"),
  new SlashCommandBuilder().setName("antibotadd").setDescription("تفعيل/تعطيل حظر إضافة البوتات"),
  new SlashCommandBuilder().setName("antiwebhook").setDescription("تفعيل/تعطيل الحماية من الويب هوك"),
  new SlashCommandBuilder().setName("ghostping").setDescription("تفعيل/تعطيل كشف Ghost Ping"),
  new SlashCommandBuilder().setName("panic").setDescription("تفعيل/تعطيل وضع الطوارئ"),

  // ═══ INFO ═══
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("معلومات عضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(false)),

  new SlashCommandBuilder().setName("serverinfo").setDescription("معلومات السيرفر"),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("عرض صورة مستخدم")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(false)),

  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("معلومات دور")
    .addRoleOption(o => o.setName("الدور").setDescription("الدور").setRequired(true)),

  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription("معلومات قناة")
    .addChannelOption(o => o.setName("القناة").setDescription("القناة").setRequired(false)),

  new SlashCommandBuilder().setName("membercount").setDescription("عدد الأعضاء"),

  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("دعوات مستخدم")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(false)),

  new SlashCommandBuilder().setName("invitelist").setDescription("قائمة الدعوات"),
  new SlashCommandBuilder().setName("clearinvites").setDescription("حذف جميع الدعوات"),

  new SlashCommandBuilder()
    .setName("raidlog")
    .setDescription("سجل محاولات الريد"),

  new SlashCommandBuilder().setName("status").setDescription("حالة الحماية"),
  new SlashCommandBuilder().setName("ping").setDescription("قياس البينغ"),
  new SlashCommandBuilder().setName("uptime").setDescription("وقت التشغيل"),
  new SlashCommandBuilder().setName("help").setDescription("قائمة الأوامر"),

  // ═══ UTILITY ═══
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("إرسال إيمبد")
    .addStringOption(o => o.setName("النص").setDescription("النص").setRequired(true)),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("إعلان رسمي")
    .addStringOption(o => o.setName("النص").setDescription("نص الإعلان").setRequired(true))
    .addChannelOption(o => o.setName("القناة").setDescription("القناة المستهدفة").setRequired(false)),

  new SlashCommandBuilder()
    .setName("dm")
    .setDescription("إرسال DM لعضو")
    .addUserOption(o => o.setName("المستخدم").setDescription("العضو").setRequired(true))
    .addStringOption(o => o.setName("الرسالة").setDescription("الرسالة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("addchannel")
    .setDescription("إنشاء قناة جديدة")
    .addStringOption(o => o.setName("الاسم").setDescription("اسم القناة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("deletechannel")
    .setDescription("حذف قناة")
    .addChannelOption(o => o.setName("القناة").setDescription("القناة").setRequired(true)),

  new SlashCommandBuilder()
    .setName("addrole")
    .setDescription("إنشاء دور جديد")
    .addStringOption(o => o.setName("الاسم").setDescription("اسم الدور").setRequired(true)),

  new SlashCommandBuilder()
    .setName("delrole")
    .setDescription("حذف دور")
    .addRoleOption(o => o.setName("الدور").setDescription("الدور").setRequired(true)),

].map(cmd => cmd.toJSON());

// ══════════════════════════════════════════
//        REGISTER SLASH COMMANDS
// ══════════════════════════════════════════

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  try {
    console.log("⏳ جاري تسجيل السلاش كوماندز...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log(`✅ تم تسجيل ${slashCommands.length} أمر بنجاح!`);
  } catch (err) {
    console.error("❌ خطأ في تسجيل الأوامر:", err);
  }
}

// ══════════════════════════════════════════
//     INTERACTION HANDLER — SLASH COMMANDS
// ══════════════════════════════════════════

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return await interaction.reply({ embeds: [errorEmbed("خطأ", "هذا الأمر يعمل داخل السيرفرات فقط.")], ephemeral: true });

  await interaction.deferReply().catch(() => {});

  const { commandName, member, guild, options } = interaction;

  const reply = (embed, ephemeral = false) =>
    interaction.editReply({ embeds: [embed] }).catch(() => {});

  // ══════════════════════════════
  //     MODERATION COMMANDS
  // ══════════════════════════════

  if (commandName === "ban") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const reason = options.getString("السبب") || "لا يوجد سبب";
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.ban({ reason, deleteMessageSeconds: 86400 }).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(0xFF1744)
      .setAuthor({ name: "🔨 BAN EXECUTED", iconURL: client.user.displayAvatarURL() })
      .setTitle("تم تنفيذ الحظر")
      .setThumbnail(target.user.displayAvatarURL())
      .addFields(
        { name: "👤 المستخدم", value: `${target.user.tag}`, inline: true },
        { name: "🆔 ID", value: target.id, inline: true },
        { name: "📋 السبب", value: reason, inline: false },
        { name: "🛡️ المشرف", value: member.user.tag, inline: true },
        { name: "⏰ الوقت", value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
    sendModLog(guild, logEmbed("BAN", 0xFF1744, [
      { name: "المستخدم", value: target.user.tag },
      { name: "المشرف", value: member.user.tag },
      { name: "السبب", value: reason },
    ]));
  }

  else if (commandName === "unban") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const userId = options.getString("id");
    await guild.members.unban(userId).catch(() => null);
    reply(successEmbed("تم رفع الحظر", `تم رفع الحظر عن ID: \`${userId}\``));
  }

  else if (commandName === "kick") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const reason = options.getString("السبب") || "لا يوجد سبب";
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.kick(reason).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(0xFF6D00)
      .setAuthor({ name: "👢 KICK EXECUTED", iconURL: client.user.displayAvatarURL() })
      .setTitle("تم الطرد")
      .setThumbnail(target.user.displayAvatarURL())
      .addFields(
        { name: "👤 المستخدم", value: target.user.tag, inline: true },
        { name: "📋 السبب", value: reason, inline: false },
        { name: "🛡️ المشرف", value: member.user.tag, inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
    sendModLog(guild, logEmbed("KICK", 0xFF6D00, [
      { name: "المستخدم", value: target.user.tag },
      { name: "المشرف", value: member.user.tag },
      { name: "السبب", value: reason },
    ]));
  }

  else if (commandName === "mute") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target   = options.getMember("المستخدم");
    const duration = options.getInteger("المدة") || 10;
    const reason   = options.getString("السبب") || "لا يوجد سبب";
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    const durationMs = duration * 60 * 1000;
    const cfg        = getConfig(guild.id);
    const muteRole   = cfg.muteRole ? guild.roles.cache.get(cfg.muteRole) : null;
    if (muteRole) {
      await target.roles.add(muteRole).catch(() => {});
      addMute(guild.id, target.id, Date.now() + durationMs, reason);
      setTimeout(async () => {
        await target.roles.remove(muteRole).catch(() => {});
        removeMute(guild.id, target.id);
      }, durationMs);
    } else {
      await target.timeout(durationMs, reason).catch(() => null);
    }
    reply(successEmbed("تم الكتم", `**${target.user.tag}** مكتوم لمدة **${duration} دقيقة**.\n**السبب:** ${reason}`));
    sendModLog(guild, logEmbed("MUTE", 0xFFD600, [
      { name: "المستخدم", value: target.user.tag },
      { name: "المدة", value: `${duration} دقيقة` },
      { name: "المشرف", value: member.user.tag },
      { name: "السبب", value: reason },
    ]));
  }

  else if (commandName === "unmute") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    const cfg      = getConfig(guild.id);
    const muteRole = cfg.muteRole ? guild.roles.cache.get(cfg.muteRole) : null;
    if (muteRole) await target.roles.remove(muteRole).catch(() => {});
    await target.timeout(null).catch(() => {});
    removeMute(guild.id, target.id);
    reply(successEmbed("تم رفع الكتم", `**${target.user.tag}** تم رفع كتمه.`));
  }

  else if (commandName === "warn") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const reason = options.getString("السبب");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    const warns = addWarn(guild.id, target.id, reason, member.id);
    const cfg   = getConfig(guild.id);

    const warnBar = "🔴".repeat(warns.length) + "⬜".repeat(Math.max(0, cfg.maxWarns - warns.length));
    const embed = new EmbedBuilder()
      .setColor(0xFFD600)
      .setAuthor({ name: "⚡ WARNING ISSUED", iconURL: client.user.displayAvatarURL() })
      .setTitle("تحذير رسمي")
      .setThumbnail(target.user.displayAvatarURL())
      .addFields(
        { name: "👤 المستخدم", value: target.user.tag, inline: true },
        { name: "🛡️ المشرف", value: member.user.tag, inline: true },
        { name: "📋 السبب", value: reason, inline: false },
        { name: "📊 التحذيرات", value: `${warnBar} \`${warns.length}/${cfg.maxWarns}\``, inline: false },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);

    if (warns.length >= cfg.maxWarns) {
      if (cfg.warnAction === "ban") target.ban({ reason: "تجاوز الحد الأقصى" }).catch(() => {});
      else if (cfg.warnAction === "kick") target.kick("تجاوز الحد الأقصى").catch(() => {});
      else target.timeout(30 * 60 * 1000, "تجاوز الحد الأقصى").catch(() => {});
      interaction.followUp({ embeds: [threatEmbed("وصل للحد الأقصى", `${target.user.tag} وصل للحد الأقصى (${cfg.maxWarns}).\nعقوبة: **${cfg.warnAction}**`, "HIGH")] });
      clearWarns(guild.id, target.id);
    }
  }

  else if (commandName === "warns") {
    const target = options.getMember("المستخدم") || member;
    const warns  = getWarns(guild.id, target.id);
    const list   = warns.length === 0
      ? "✅ لا يوجد تحذيرات."
      : warns.map((w, i) => `\`${i + 1}.\` ${w.reason} — <t:${Math.floor(w.time / 1000)}:R>`).join("\n");
    reply(infoEmbed(`تحذيرات ${target.user.tag}`, list));
  }

  else if (commandName === "clearwarns") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    clearWarns(guild.id, target.id);
    reply(successEmbed("مسح التحذيرات", `تم مسح جميع تحذيرات **${target.user.tag}**.`));
  }

  else if (commandName === "purge") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const amount = options.getInteger("العدد");
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    reply(successEmbed("تم الحذف", `تم حذف **${deleted?.size || amount}** رسالة.`));
  }

  else if (commandName === "purgeuser") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getUser("المستخدم");
    const amount = options.getInteger("العدد") || 10;
    const msgs   = await interaction.channel.messages.fetch({ limit: 100 });
    const toDelete = msgs.filter((m) => m.author.id === target.id).first(amount);
    await interaction.channel.bulkDelete(toDelete, true).catch(() => {});
    reply(successEmbed("تم الحذف", `تم حذف رسائل **${target.tag}**.`));
  }

  else if (commandName === "timeout") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const mins   = options.getInteger("الدقائق");
    const reason = options.getString("السبب") || "لا يوجد سبب";
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.timeout(mins * 60 * 1000, reason).catch(() => null);
    reply(successEmbed("Timeout", `**${target.user.tag}** مُوقَّت لمدة **${mins} دقيقة**.`));
  }

  else if (commandName === "untimeout") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.timeout(null).catch(() => null);
    reply(successEmbed("رفع Timeout", `تم رفع التوقيت عن **${target.user.tag}**.`));
  }

  else if (commandName === "softban") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const reason = options.getString("السبب") || "لا يوجد سبب";
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.ban({ reason: `Softban: ${reason}`, deleteMessageSeconds: 604800 });
    await guild.members.unban(target.id).catch(() => {});
    reply(successEmbed("Softban", `**${target.user.tag}** تم طرده وحذف رسائله لآخر 7 أيام.`));
  }

  else if (commandName === "massban") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const ids    = options.getString("ids").split(/\s+/).filter(a => /^\d{17,19}$/.test(a));
    if (!ids.length) return reply(errorEmbed("خطأ", "لم أجد أي ID صحيح."));
    let banned = 0;
    for (const id of ids) { await guild.members.ban(id, { reason: "Mass Ban" }).catch(() => {}); banned++; }
    reply(successEmbed("Mass Ban", `تم باند **${banned}** مستخدم.`));
  }

  else if (commandName === "banlist") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const bans = await guild.bans.fetch().catch(() => null);
    if (!bans) return reply(errorEmbed("خطأ", "لم أستطع جلب القائمة."));
    const list = [...bans.values()].slice(0, 20).map(b => `• ${b.user.tag} — ${b.reason || "لا سبب"}`).join("\n");
    reply(infoEmbed(`قائمة الحظر (${bans.size})`, bans.size === 0 ? "لا يوجد محظورين." : list));
  }

  else if (commandName === "note") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const note   = options.getString("الملاحظة");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    addNote(guild.id, target.id, note, member.id);
    reply(successEmbed("تمت إضافة الملاحظة", `ملاحظة مضافة لـ **${target.user.tag}**.`));
  }

  else if (commandName === "notes") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    const notes  = getNotes(guild.id, target.id);
    reply(infoEmbed(`ملاحظات ${target.user.tag}`, notes.length === 0 ? "لا توجد ملاحظات." : notes.map((n,i) => `**${i+1}.** ${n.note} — <t:${Math.floor(n.time/1000)}:R>`).join("\n")));
  }

  else if (commandName === "nick") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getMember("المستخدم");
    const nick   = options.getString("الكنية") || null;
    if (!target) return reply(errorEmbed("خطأ", "لم أجد المستخدم."));
    await target.setNickname(nick).catch(() => {});
    reply(successEmbed("تغيير الكنية", `تم تغيير كنية **${target.user.tag}** إلى \`${nick || "الاسم الأصلي"}\`.`));
  }

  else if (commandName === "role") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const action   = options.getString("الإجراء");
    const target   = options.getMember("المستخدم");
    const roleArg  = options.getRole("الدور");
    if (!target || !roleArg) return reply(errorEmbed("خطأ", "بيانات ناقصة."));
    if (action === "add") await target.roles.add(roleArg).catch(() => {});
    else await target.roles.remove(roleArg).catch(() => {});
    reply(successEmbed("تعديل الأدوار", `تم **${action === "add" ? "إضافة" : "إزالة"}** ${roleArg} ${action === "add" ? "لـ" : "من"} **${target.user.tag}**.`));
  }

  else if (commandName === "slowmode") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const seconds = options.getInteger("الثواني");
    await interaction.channel.setRateLimitPerUser(seconds).catch(() => {});
    reply(successEmbed("السلوموود", seconds === 0 ? "تم إيقاف السلوموود." : `تم تعيين السلوموود إلى **${seconds} ثانية**.`));
  }

  else if (commandName === "lock") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const reason = options.getString("السبب") || "قفل بواسطة المشرف";
    await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    reply(wanoEmbed("🔒 قناة مقفلة", `تم قفل القناة.\n**السبب:** ${reason}`, 0xFF1744));
    sendLog(guild, logEmbed("LOCK", 0xFF1744, [
      { name: "القناة", value: `${interaction.channel}` },
      { name: "المشرف", value: member.user.tag },
      { name: "السبب", value: reason },
    ]));
  }

  else if (commandName === "unlock") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
    reply(successEmbed("🔓 قناة مفتوحة", "تم فتح القناة."));
    sendLog(guild, logEmbed("UNLOCK", 0x00E676, [{ name: "القناة", value: `${interaction.channel}` }, { name: "المشرف", value: member.user.tag }]));
  }

  else if (commandName === "lockall") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    const locked   = [];
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
      locked.push(ch.id);
    }
    setLocked(guild.id, locked);
    reply(wanoEmbed("🔒 جميع القنوات مقفلة", `تم قفل **${locked.length}** قناة.`, 0xFF0000));
  }

  else if (commandName === "unlockall") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const channels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
    }
    setLocked(guild.id, []);
    reply(successEmbed("🔓 جميع القنوات مفتوحة", "تم فتح جميع القنوات."));
  }

  // ══════════════════════════════
  //     BLACKLIST / WHITELIST
  // ══════════════════════════════

  else if (commandName === "blacklist") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const action = options.getString("الإجراء");
    const word   = options.getString("الكلمة");

    if (action === "add") {
      if (!word) return reply(errorEmbed("خطأ", "أدخل الكلمة."));
      addBlacklistWord(guild.id, word);
      reply(successEmbed("تمت الإضافة", `\`${word}\` مضافة للقائمة السوداء.`));
    } else if (action === "remove") {
      if (!word) return reply(errorEmbed("خطأ", "أدخل الكلمة."));
      removeBlacklistWord(guild.id, word);
      reply(successEmbed("تمت الإزالة", `\`${word}\` تمت إزالتها.`));
    } else {
      const bl = getBlacklist(guild.id);
      reply(infoEmbed("القائمة السوداء", bl.words.length === 0 ? "القائمة فارغة." : bl.words.map(w => `• \`${w}\``).join("\n")));
    }
  }

  else if (commandName === "whitelist") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const action = options.getString("الإجراء");
    const target = options.getUser("المستخدم");
    const cfg    = getConfig(guild.id);

    if (action === "add") {
      if (!target) return reply(errorEmbed("خطأ", "حدد المستخدم."));
      const list = cfg.whitelistedUsers || [];
      if (!list.includes(target.id)) list.push(target.id);
      setConfig(guild.id, "whitelistedUsers", list);
      reply(successEmbed("Whitelist", `تمت إضافة **${target.tag}** للقائمة البيضاء.`));
    } else if (action === "remove") {
      if (!target) return reply(errorEmbed("خطأ", "حدد المستخدم."));
      setConfig(guild.id, "whitelistedUsers", (cfg.whitelistedUsers || []).filter(id => id !== target.id));
      reply(successEmbed("Whitelist", `تمت إزالة **${target.tag}** من القائمة البيضاء.`));
    } else {
      const list = cfg.whitelistedUsers || [];
      reply(infoEmbed("القائمة البيضاء", list.length === 0 ? "القائمة فارغة." : list.map(id => `• \`${id}\``).join("\n")));
    }
  }

  // ══════════════════════════════
  //     CONFIG COMMANDS
  // ══════════════════════════════

  else if (commandName === "setlog") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const ch = options.getChannel("القناة");
    setConfig(guild.id, "logChannel", ch.id);
    reply(successEmbed("تم", `قناة السجلات: ${ch}`));
  }

  else if (commandName === "setmodlog") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const ch = options.getChannel("القناة");
    setConfig(guild.id, "modLogChannel", ch.id);
    reply(successEmbed("تم", `قناة سجلات المود: ${ch}`));
  }

  else if (commandName === "setmuterole") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const role = options.getRole("الدور");
    setConfig(guild.id, "muteRole", role.id);
    reply(successEmbed("تم", `دور الكتم: ${role}`));
  }

  else if (commandName === "setautorole") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const role = options.getRole("الدور");
    setConfig(guild.id, "autoRole", role.id);
    reply(successEmbed("تم", `الأوتورول: ${role} — يُعطى لكل عضو جديد.`));
  }

  else if (commandName === "setmaxwarns") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const n = options.getInteger("العدد");
    setConfig(guild.id, "maxWarns", n);
    reply(successEmbed("تم", `الحد الأقصى للتحذيرات: **${n}**`));
  }

  else if (commandName === "setwarnaction") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const action = options.getString("الإجراء");
    setConfig(guild.id, "warnAction", action);
    reply(successEmbed("تم", `إجراء التحذيرات: **${action}**`));
  }

  // ══════════════════════════════
  //     TOGGLE COMMANDS
  // ══════════════════════════════

  else if ([
    "antispam","antiraid","antinuke","antilinks","antiinvites",
    "antimassmention","anticaps","antiemoji","antibotadd","antiwebhook","ghostping"
  ].includes(commandName)) {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const keyMap = {
      antispam: "antiSpam", antiraid: "antiRaid", antinuke: "antiNuke",
      antilinks: "antiLinks", antiinvites: "antiInvites",
      antimassmention: "antiMassMention", anticaps: "antiCaps",
      antiemoji: "antiEmoji", antibotadd: "antiBotAdd",
      antiwebhook: "antiWebhook", ghostping: "ghostPing",
    };
    const key    = keyMap[commandName];
    const cfg    = getConfig(guild.id);
    const newVal = !cfg[key];
    setConfig(guild.id, key, newVal);

    const statusBar = newVal
      ? "```diff\n+ ✅ ENABLED\n```"
      : "```diff\n- ❌ DISABLED\n```";
    const embed = new EmbedBuilder()
      .setColor(newVal ? 0x00E676 : 0xFF1744)
      .setAuthor({ name: "⚙️ PROTECTION TOGGLE", iconURL: client.user.displayAvatarURL() })
      .setTitle(`${commandName.toUpperCase()}`)
      .setDescription(statusBar + CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "panic") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const current = getPanicMode(guild.id);
    const newVal  = !current;
    setPanicMode(guild.id, newVal);

    if (newVal) {
      guild.channels.cache.filter(c => c.type === ChannelType.GuildText).forEach(ch =>
        ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {}));
      reply(threatEmbed("وضع الطوارئ مُفعّل", "جميع القنوات مقفلة. فقط الإدمن يكتب.", "PANIC"));
    } else {
      guild.channels.cache.filter(c => c.type === ChannelType.GuildText).forEach(ch =>
        ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {}));
      reply(successEmbed("وضع الطوارئ مُلغى", "تم إلغاء وضع الطوارئ وفتح الكل."));
    }
    sendLog(guild, logEmbed("PANIC", newVal ? 0xFF0000 : 0x00E676, [
      { name: "الحالة", value: newVal ? "🆘 مُفعّل" : "✅ مُلغى" },
      { name: "بواسطة", value: member.user.tag },
    ]));
  }

  // ══════════════════════════════
  //     INFO COMMANDS
  // ══════════════════════════════

  else if (commandName === "userinfo") {
    const target = options.getMember("المستخدم") || member;
    const warns  = getWarns(guild.id, target.id);
    const warnBar = warns.length === 0 ? "⬜⬜⬜⬜⬜" : "🔴".repeat(Math.min(warns.length, 5));
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "◈ USER PROFILE", iconURL: client.user.displayAvatarURL() })
      .setTitle(target.user.tag)
      .setThumbnail(target.user.displayAvatarURL({ size: 256, dynamic: true }))
      .addFields(
        { name: "🆔 ID", value: `\`${target.id}\``, inline: true },
        { name: "🤖 بوت", value: target.user.bot ? "✅" : "❌", inline: true },
        { name: "📅 تاريخ إنشاء الحساب", value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: false },
        { name: "📥 تاريخ الانضمام", value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: "⚠️ التحذيرات", value: `${warnBar} \`${warns.length}\``, inline: false },
        { name: "🎭 الأدوار", value: target.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(", ") || "لا يوجد", inline: false },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "serverinfo") {
    const g     = guild;
    const bots  = g.members.cache.filter(m => m.user.bot).size;
    const humans = g.memberCount - bots;
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "◈ SERVER INTEL", iconURL: client.user.displayAvatarURL() })
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ dynamic: true }))
      .addFields(
        { name: "🆔 ID", value: `\`${g.id}\``, inline: true },
        { name: "👑 المالك", value: `<@${g.ownerId}>`, inline: true },
        { name: "👥 الأعضاء", value: `👤 ${humans} بشر | 🤖 ${bots} بوت`, inline: false },
        { name: "📢 القنوات", value: `${g.channels.cache.size}`, inline: true },
        { name: "🎭 الأدوار", value: `${g.roles.cache.size}`, inline: true },
        { name: "🚀 Boosts", value: `${g.premiumSubscriptionCount || 0}`, inline: true },
        { name: "📅 تاريخ الإنشاء", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: false },
        { name: "🔒 التحقق", value: `${g.verificationLevel}`, inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "avatar") {
    const target = options.getUser("المستخدم") || interaction.user;
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "🖼️ AVATAR VIEWER", iconURL: client.user.displayAvatarURL() })
      .setTitle(target.tag)
      .setImage(target.displayAvatarURL({ size: 4096, dynamic: true }))
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("PNG").setStyle(ButtonStyle.Link).setURL(target.displayAvatarURL({ extension: "png", size: 4096 })),
      new ButtonBuilder().setLabel("JPG").setStyle(ButtonStyle.Link).setURL(target.displayAvatarURL({ extension: "jpg", size: 4096 })),
      new ButtonBuilder().setLabel("WEBP").setStyle(ButtonStyle.Link).setURL(target.displayAvatarURL({ extension: "webp", size: 4096 })),
    );
    interaction.editReply({ embeds: [embed], components: [row] }).catch(() => {});
  }

  else if (commandName === "roleinfo") {
    const role = options.getRole("الدور");
    const embed = new EmbedBuilder()
      .setColor(role.color || 0xE84141)
      .setAuthor({ name: "◈ ROLE INTEL", iconURL: client.user.displayAvatarURL() })
      .setTitle(role.name)
      .addFields(
        { name: "🆔 ID", value: `\`${role.id}\``, inline: true },
        { name: "🎨 اللون", value: role.hexColor, inline: true },
        { name: "👥 الأعضاء", value: `${role.members.size}`, inline: true },
        { name: "📌 Mentionable", value: role.mentionable ? "✅" : "❌", inline: true },
        { name: "📌 Hoisted", value: role.hoist ? "✅" : "❌", inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "channelinfo") {
    const ch = options.getChannel("القناة") || interaction.channel;
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "◈ CHANNEL INTEL", iconURL: client.user.displayAvatarURL() })
      .setTitle(`# ${ch.name}`)
      .addFields(
        { name: "🆔 ID", value: `\`${ch.id}\``, inline: true },
        { name: "📌 النوع", value: `${ch.type}`, inline: true },
        { name: "📅 تاريخ الإنشاء", value: `<t:${Math.floor(ch.createdTimestamp / 1000)}:R>`, inline: false },
        { name: "🔞 NSFW", value: ch.nsfw ? "✅" : "❌", inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "membercount") {
    const bots   = guild.members.cache.filter(m => m.user.bot).size;
    const humans = guild.memberCount - bots;
    const ratio  = Math.round((humans / guild.memberCount) * 100);
    const bar    = "█".repeat(Math.floor(ratio / 10)) + "░".repeat(10 - Math.floor(ratio / 10));
    const embed = new EmbedBuilder()
      .setColor(0x29B6F6)
      .setAuthor({ name: "◈ MEMBER COUNTER", iconURL: client.user.displayAvatarURL() })
      .setTitle(`${guild.name} — عدد الأعضاء`)
      .setDescription(
        `\`\`\`\n[${bar}] ${ratio}% بشر\n\`\`\`` +
        `👤 **بشر:** ${humans}\n🤖 **بوتات:** ${bots}\n📊 **الكل:** ${guild.memberCount}` +
        CREDITS
      )
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "invites") {
    const target  = options.getMember("المستخدم") || member;
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return reply(errorEmbed("خطأ", "لا أستطيع جلب الدعوات."));
    const userInvites = invites.filter(i => i.inviter?.id === target.id);
    const total       = userInvites.reduce((sum, i) => sum + i.uses, 0);
    reply(infoEmbed(`دعوات ${target.user.tag}`, `**الروابط:** ${userInvites.size}\n**الاستخدامات الكلية:** ${total}`));
  }

  else if (commandName === "invitelist") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return reply(errorEmbed("خطأ", "لا أستطيع جلب الدعوات."));
    const list = [...invites.values()].slice(0, 15).map(i => `• \`${i.code}\` — ${i.inviter?.tag || "؟"} — ${i.uses} استخدام`).join("\n");
    reply(infoEmbed(`قائمة الدعوات (${invites.size})`, list || "لا توجد دعوات."));
  }

  else if (commandName === "clearinvites") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;
    let deleted = 0;
    for (const [, inv] of invites) { await inv.delete().catch(() => {}); deleted++; }
    reply(successEmbed("تم", `تم حذف **${deleted}** دعوة.`));
  }

  else if (commandName === "raidlog") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const log = getRaidLog(guild.id).slice(-20);
    reply(infoEmbed("سجل الريد", log.length === 0 ? "لا يوجد سجل." : log.map(e => `• \`${e.userId}\` — <t:${Math.floor(e.time / 1000)}:R>`).join("\n")));
  }

  else if (commandName === "status") {
    const cfg = getConfig(guild.id);
    const on  = "🟢";
    const off = "🔴";
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "🛡️ PROTECTION STATUS", iconURL: client.user.displayAvatarURL() })
      .setTitle(`${guild.name} — حالة الحماية`)
      .addFields(
        { name: "AntiSpam",       value: cfg.antiSpam ? on : off, inline: true },
        { name: "AntiRaid",       value: cfg.antiRaid ? on : off, inline: true },
        { name: "AntiNuke",       value: cfg.antiNuke ? on : off, inline: true },
        { name: "AntiLinks",      value: cfg.antiLinks ? on : off, inline: true },
        { name: "AntiInvites",    value: cfg.antiInvites ? on : off, inline: true },
        { name: "MassMention",    value: cfg.antiMassMention ? on : off, inline: true },
        { name: "AntiCaps",       value: cfg.antiCaps ? on : off, inline: true },
        { name: "AntiEmoji",      value: cfg.antiEmoji ? on : off, inline: true },
        { name: "AntiBotAdd",     value: cfg.antiBotAdd ? on : off, inline: true },
        { name: "AntiWebhook",    value: cfg.antiWebhook ? on : off, inline: true },
        { name: "GhostPing",      value: cfg.ghostPing ? on : off, inline: true },
        { name: "Panic Mode",     value: getPanicMode(guild.id) ? "🆘 مُفعّل" : "✅ معطّل", inline: true },
        { name: "Log Channel",    value: cfg.logChannel ? `<#${cfg.logChannel}>` : "❌ لم يُحدد", inline: true },
        { name: "Max Warns",      value: `${cfg.maxWarns}`, inline: true },
        { name: "Warn Action",    value: cfg.warnAction, inline: true },
      )
      .setDescription(CREDITS)
      .setFooter({ text: "🛡️ Wano Security · مروان | Wano Studio · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "ping") {
    const start = Date.now();
    const latency = Date.now() - start;
    const ping  = client.ws.ping;
    const quality = ping < 100 ? "🟢 ممتاز" : ping < 200 ? "🟡 جيد" : "🔴 بطيء";
    const embed = new EmbedBuilder()
      .setColor(ping < 100 ? 0x00E676 : ping < 200 ? 0xFFD600 : 0xFF1744)
      .setAuthor({ name: "🏓 PING METER", iconURL: client.user.displayAvatarURL() })
      .setTitle("اختبار الاستجابة")
      .setDescription(
        `\`\`\`\nBot  : ${latency}ms\nAPI  : ${ping}ms\n\`\`\`` +
        `**الجودة:** ${quality}` + CREDITS
      )
      .setFooter({ text: "🛡️ Wano Security · @wn6b" })
      .setTimestamp();
    reply(embed);
  }

  else if (commandName === "uptime") {
    const ms = client.uptime;
    const s  = Math.floor(ms / 1000) % 60;
    const m  = Math.floor(ms / 60000) % 60;
    const h  = Math.floor(ms / 3600000) % 24;
    const d  = Math.floor(ms / 86400000);
    reply(infoEmbed("⏱️ Uptime", `\`${d}d ${h}h ${m}m ${s}s\`` + `\n\nالبوت يعمل منذ <t:${Math.floor((Date.now() - ms) / 1000)}:R>`));
  }

  else if (commandName === "help") {
    const sections = [
      { name: "⚔️ مودريشن", value: "`/ban` `/unban` `/kick` `/mute` `/unmute`\n`/warn` `/warns` `/clearwarns`\n`/timeout` `/untimeout` `/softban` `/massban`\n`/purge` `/purgeuser` `/nick` `/role`\n`/slowmode` `/lock` `/unlock` `/lockall` `/unlockall`" },
      { name: "🛡️ حماية", value: "`/antispam` `/antiraid` `/antinuke`\n`/antilinks` `/antiinvites` `/antimassmention`\n`/anticaps` `/antiemoji` `/antibotadd`\n`/antiwebhook` `/ghostping` `/panic`\n`/blacklist` `/whitelist` `/raidlog` `/status`" },
      { name: "ℹ️ معلومات", value: "`/userinfo` `/serverinfo` `/avatar`\n`/roleinfo` `/channelinfo` `/membercount`\n`/invites` `/invitelist` `/ping` `/uptime`" },
      { name: "⚙️ إعدادات", value: "`/setlog` `/setmodlog` `/setmuterole`\n`/setautorole` `/setmaxwarns` `/setwarnaction`\n`/addrole` `/delrole` `/addchannel` `/deletechannel`\n`/note` `/notes` `/clearinvites`" },
      { name: "📢 أخرى", value: "`/embed` `/announce` `/dm`\n`!say` `!announce` ← بريفكس فقط" },
    ];
    const embed = new EmbedBuilder()
      .setColor(0xE84141)
      .setAuthor({ name: "🛡️ WANO SECURITY BOT — COMMAND CENTER", iconURL: client.user.displayAvatarURL() })
      .setTitle("قائمة الأوامر الكاملة")
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription(`جميع الأوامر سلاش كوماند \`/\` — باستثناء \`!say\` و\`!announce\`${CREDITS}`);
    for (const s of sections) embed.addFields({ name: s.name, value: s.value, inline: false });
    embed.setFooter({ text: "🛡️ Wano Security Bot v4.0 · مروان | Wano Studio · @wn6b" }).setTimestamp();
    reply(embed);
  }

  // ══════════════════════════════
  //     UTILITY COMMANDS
  // ══════════════════════════════

  else if (commandName === "embed") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const text = options.getString("النص");
    interaction.channel.send({ embeds: [wanoEmbed("📢 إعلان", text)] });
    reply(successEmbed("تم الإرسال", "تم إرسال الإيمبد."));
  }

  else if (commandName === "announce") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const text = options.getString("النص");
    const ch   = options.getChannel("القناة") || interaction.channel;
    const targetCh = guild.channels.cache.get(ch.id);
    targetCh.send({ content: "@everyone", embeds: [wanoEmbed("📢 إعلان رسمي", text)] });
    reply(successEmbed("تم الإعلان", `تم الإرسال في ${ch}.`));
  }

  else if (commandName === "dm") {
    if (!isMod(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين."));
    const target = options.getUser("المستخدم");
    const msg    = options.getString("الرسالة");
    target.send({ embeds: [infoEmbed(`رسالة من ${guild.name}`, msg)] })
      .catch(() => reply(errorEmbed("خطأ", "لا يمكن إرسال DM.")));
    reply(successEmbed("تم الإرسال", `تم إرسال DM لـ **${target.tag}**.`));
  }

  else if (commandName === "addchannel") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const name = options.getString("الاسم");
    const ch   = await guild.channels.create({ name, type: ChannelType.GuildText }).catch(() => null);
    reply(ch ? successEmbed("تم إنشاء القناة", `تم إنشاء ${ch}`) : errorEmbed("خطأ", "فشل إنشاء القناة."));
  }

  else if (commandName === "deletechannel") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const ch   = options.getChannel("القناة");
    const name = ch.name;
    const targetCh = guild.channels.cache.get(ch.id);
    await targetCh.delete().catch(() => {});
    reply(successEmbed("تم الحذف", `تم حذف القناة \`${name}\`.`));
  }

  else if (commandName === "addrole") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const name = options.getString("الاسم");
    const role = await guild.roles.create({ name, reason: `بواسطة ${member.user.tag}` }).catch(() => null);
    reply(role ? successEmbed("تم إنشاء الدور", `تم إنشاء ${role}`) : errorEmbed("خطأ", "فشل إنشاء الدور."));
  }

  else if (commandName === "delrole") {
    if (!isAdmin(member)) return reply(errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن."));
    const role = options.getRole("الدور");
    const name = role.name;
    await guild.roles.cache.get(role.id)?.delete().catch(() => {});
    reply(successEmbed("تم الحذف", `تم حذف دور \`${name}\`.`));
  }
});

// ══════════════════════════════════════════
//   PREFIX COMMANDS — !say و !announce فقط
// ══════════════════════════════════════════

const PREFIX = "!";

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  // Auto-protection checks
  if (await checkBlacklist(message)) return;
  if (await checkLinks(message)) return;
  if (await checkMassMention(message)) return;
  if (await checkEmojiSpam(message)) return;
  if (await checkCaps(message)) return;
  if (await checkSpam(message)) return;

  // Ghost ping cache
  const config = getConfig(message.guild.id);
  if (config.ghostPing && message.mentions.users.size > 0) {
    ghostPingCache.set(message.id, {
      author: message.author.id,
      mentions: [...message.mentions.users.keys()],
      channel: message.channel.id,
      content: message.content,
    });
    setTimeout(() => ghostPingCache.delete(message.id), 30000);
  }

  // Panic mode
  if (getPanicMode(message.guild.id) && !isMod(message.member)) {
    message.delete().catch(() => {});
    return;
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd  = args.shift().toLowerCase();

  // !say — بريفكس فقط (منطقي لأن البوت يحذف الرسالة)
  if (cmd === "say") {
    if (!isMod(message.member)) return message.reply({ embeds: [errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية المشرفين.")] });
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [errorEmbed("خطأ", "أدخل النص.")] });
    message.delete().catch(() => {});
    message.channel.send(text);
  }

  // !announce — بريفكس فقط
  else if (cmd === "announce") {
    if (!isAdmin(message.member)) return message.reply({ embeds: [errorEmbed("صلاحيات ناقصة", "تحتاج صلاحية الإدمن.")] });
    const ch   = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
    const text = args.slice(ch ? 1 : 0).join(" ");
    const target = ch || message.channel;
    message.delete().catch(() => {});
    target.send({ content: "@everyone", embeds: [wanoEmbed("📢 إعلان رسمي", text)] });
  }
});

// ══════════════════════════════════════════
//     EVENT: MESSAGE DELETE (Ghost Ping)
// ══════════════════════════════════════════

client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  const config = getConfig(message.guild.id);

  if (config.ghostPing && ghostPingCache.has(message.id)) {
    const data      = ghostPingCache.get(message.id);
    const mentioned = data.mentions.map(id => `<@${id}>`).join(", ");
    const embed     = logEmbed("GHOST", 0xFF8C00, [
      { name: "👻 المرسل", value: `<@${data.author}>` },
      { name: "📢 القناة", value: `<#${data.channel}>` },
      { name: "🔔 المنشنات", value: mentioned },
      { name: "💬 الرسالة", value: data.content.slice(0, 100) || "—" },
    ]);
    const ch = message.guild.channels.cache.get(data.channel);
    if (ch) ch.send({ embeds: [embed] });
    sendLog(message.guild, embed);
    ghostPingCache.delete(message.id);
  }

  sendLog(message.guild, logEmbed("DELETE", 0xFF4040, [
    { name: "المرسل", value: message.author?.tag || "؟" },
    { name: "القناة", value: `${message.channel}` },
    { name: "المحتوى", value: message.content?.slice(0, 300) || "—", inline: false },
  ]));
});

// ══════════════════════════════════════════
//     EVENT: MESSAGE UPDATE
// ══════════════════════════════════════════

client.on("messageUpdate", async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  sendLog(oldMsg.guild, logEmbed("EDIT", 0xFFD600, [
    { name: "المرسل", value: oldMsg.author?.tag || "؟" },
    { name: "القناة", value: `${oldMsg.channel}` },
    { name: "قبل", value: oldMsg.content?.slice(0, 300) || "؟", inline: false },
    { name: "بعد", value: newMsg.content?.slice(0, 300) || "؟", inline: false },
  ]));
  if (newMsg.member) {
    await checkBlacklist(newMsg);
    await checkLinks(newMsg);
    await checkMassMention(newMsg);
  }
});

// ══════════════════════════════════════════
//     EVENT: GUILD MEMBER ADD
// ══════════════════════════════════════════

client.on("guildMemberAdd", async (member) => {
  const config = getConfig(member.guild.id);
  await checkRaid(member);

  if (config.autoRole) {
    const role = member.guild.roles.cache.get(config.autoRole);
    if (role) member.roles.add(role).catch(() => {});
  }

  const ageInDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
  if (ageInDays < (config.newAccountThreshold || 7)) {
    sendLog(member.guild, threatEmbed(
      "حساب جديد جداً",
      `العضو: ${member.user.tag}\nعمر الحساب: ${Math.floor(ageInDays)} يوم\nالحد: ${config.newAccountThreshold} أيام`,
      "MEDIUM"
    ));
  }

  sendLog(member.guild, logEmbed("JOIN", 0x00E676, [
    { name: "العضو", value: `${member.user.tag} (${member.id})` },
    { name: "عمر الحساب", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
  ]));
});

// ══════════════════════════════════════════
//     EVENT: GUILD MEMBER REMOVE
// ══════════════════════════════════════════

client.on("guildMemberRemove", async (member) => {
  sendLog(member.guild, logEmbed("LEAVE", 0xFF4040, [
    { name: "العضو", value: `${member.user.tag} (${member.id})` },
  ]));

  // AntiNuke - kicks
  const config = getConfig(member.guild.id);
  if (!config.antiNuke) return;
  try {
    const logs  = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
    const entry = logs.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    const count = trackNukeAction(member.guild.id, entry.executor.id, "kicks");
    await handleNukeAttempt(member.guild, entry.executor.id, "kicks", count);
  } catch {}
});

// ══════════════════════════════════════════
//     EVENT: ANTI-NUKE LISTENERS
// ══════════════════════════════════════════

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  const config = getConfig(channel.guild.id);
  if (!config.antiNuke) return;
  try {
    const logs  = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id, "channelDeletes");
    await handleNukeAttempt(channel.guild, entry.executor.id, "channelDeletes", count);
  } catch {}
});

client.on("guildBanAdd", async (ban) => {
  const config = getConfig(ban.guild.id);
  if (!config.antiNuke) return;
  try {
    const logs  = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNukeAction(ban.guild.id, entry.executor.id, "bans");
    await handleNukeAttempt(ban.guild, entry.executor.id, "bans", count);
  } catch {}
});

client.on("webhookUpdate", async (channel) => {
  const config = getConfig(channel.guild.id);
  if (!config.antiWebhook) return;
  try {
    const logs  = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 1 });
    const entry = logs.entries.first();
    if (!entry) return;
    const count = trackNukeAction(channel.guild.id, entry.executor.id, "webhookCreates");
    if (count >= NUKE_THRESHOLDS.webhookCreates) {
      const webhooks = await channel.fetchWebhooks().catch(() => null);
      if (webhooks) webhooks.forEach(wh => wh.delete("AntiWebhook").catch(() => {}));
      sendLog(channel.guild, logEmbed("WEBHOOK", 0xFF0000, [
        { name: "المستخدم", value: entry.executor.tag },
        { name: "الإجراء", value: "تم حذف الويب هوك تلقائياً" },
      ]));
    }
  } catch {}
});

// ══════════════════════════════════════════
//     EVENT: BOT ADD (AntiBotAdd)
// ══════════════════════════════════════════

client.on("guildMemberAdd", async (member) => {
  if (!member.user.bot) return;
  const config = getConfig(member.guild.id);
  if (!config.antiBotAdd || config.whitelistedBots?.includes(member.id)) return;
  try {
    const logs  = await member.guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 1 });
    const entry = logs.entries.first();
    if (entry) {
      sendLog(member.guild, logEmbed("BOT", 0xFF0000, [
        { name: "البوت", value: member.user.tag },
        { name: "المضيف", value: entry.executor?.tag || "؟" },
        { name: "الإجراء", value: "تم الطرد تلقائياً" },
      ]));
    }
    await member.kick("AntiBotAdd").catch(() => {});
  } catch {}
});

// ══════════════════════════════════════════
//     MUTE RECOVERY ON RESTART
// ══════════════════════════════════════════

client.on("ready", async () => {
  console.log(`\n┌─────────────────────────────────────────┐`);
  console.log(`│  🛡️  Wano Security Bot v4.0 — ONLINE     │`);
  console.log(`│  👤  ${client.user.tag.padEnd(36)}│`);
  console.log(`│  🌐  Guilds: ${String(client.guilds.cache.size).padEnd(29)}│`);
  console.log(`│  ✦   By: مروان | Wano Studio (@wn6b)    │`);
  console.log(`└─────────────────────────────────────────┘\n`);

  client.user.setPresence({
    activities: [{ name: "Best Security Bot | عنتيل المحلة", type: 3 }],
    status: "dnd",
  });

  await registerCommands();

  // Resume temp mutes
  for (const [guildId, users] of Object.entries(loadDB("mutes"))) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const cfg      = getConfig(guildId);
    const muteRole = cfg.muteRole ? guild.roles.cache.get(cfg.muteRole) : null;
    for (const [userId, data] of Object.entries(users)) {
      const remaining = data.endsAt - Date.now();
      if (remaining <= 0) { removeMute(guildId, userId); continue; }
      if (muteRole) {
        setTimeout(async () => {
          const m = guild.members.cache.get(userId);
          if (m) await m.roles.remove(muteRole).catch(() => {});
          removeMute(guildId, userId);
        }, remaining);
      }
    }
  }
});

// ══════════════════════════════════════════
//            LOGIN
// ══════════════════════════════════════════

client.login(process.env.TOKEN);
