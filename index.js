// index.js – strict two-way verify: reddit name + Discord username/globalName must match
// parses content from embeds + content
// adds Reddit profile link on success
// adds !reddit command usable in any channel (except modmail)
// verify channel: only !verify allowed, other messages deleted
// verify channel: slowmode applied on startup

import dotenv from 'dotenv';
dotenv.config();

import {
  Client,
  GatewayIntentBits,
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ---- Config ----

const GUILD_ID = process.env.GUILD_ID;
const MODMAIL_CHANNEL_ID = process.env.WATCH_CHANNEL_ID;              // forwarded modmail channel
const VERIFY_CHANNEL_ID = process.env.VERIFY_COMMAND_CHANNEL_ID;      // !verify channel
const ROLE_ID = process.env.ROLE_ID;
const LOOKBACK_HOURS = Number(process.env.MODMAIL_LOOKBACK_HOURS || '12');
// slowmode in seconds for verify channel
const VERIFY_SLOWMODE_SECONDS = Number(process.env.VERIFY_SLOWMODE_SECONDS || '30');

// ---- Helpers ----

function normalize(str) {
  return (str || '').trim().toLowerCase();
}

// Strip simple markdown like **text** and [**text**](url)
function stripMarkdown(str) {
  if (!str) return str;

  // Remove surrounding ** **
  str = str.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '');

  // Remove basic markdown link wrapper: [**name**](...)
  const linkMatch = str.match(/^\[([^\]]+)\]\([^)]+\)$/);
  if (linkMatch) {
    str = linkMatch[1];
  }

  // Strip ** again inside link text
  str = str.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '');
  return str.trim();
}

/**
 * Build a unified text representation from:
 * - message.content
 * - all embed descriptions
 * - all embed fields as "Name: Value"
 */
function buildFullTextFromMessage(message) {
  const parts = [];

  if (message.content && message.content.trim().length > 0) {
    parts.push(message.content);
  }

  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.description) {
        parts.push(embed.description);
      }
      if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
          const name = field.name || '';
          const value = field.value || '';
          parts.push(`${name}: ${value}`);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Parse forwarded modmail message into:
 * { redditName, discordName, status }
 *
 * We now expect the combined text from buildFullTextFromMessage(message)
 */
function parseModmailMessageFromFullText(fullText) {
  const rawLines = fullText.split('\n');
  const lines = rawLines.map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // Ignore pure "✅ Linked Reddit..." or bot log lines
  if (lines[0].startsWith('✅ Linked Reddit') || lines[0].startsWith("I couldn't find a member")) {
    return null;
  }

  // 1) Author line → reddit name
  const authorLine = lines.find(line => line.toLowerCase().startsWith('author:'));
  let redditName = null;
  if (authorLine) {
    let namePart = authorLine.replace(/^author:\s*/i, '').trim();
    namePart = stripMarkdown(namePart);
    redditName = namePart || null;
  }

  // Fallback: if no Author line, use first non-empty line
  if (!redditName) {
    redditName = stripMarkdown(lines[0]);
  }

  // 2) Body line → Discord name (username/global)
  const bodyLine = lines.find(line => line.toLowerCase().startsWith('body:'));
  let discordName = null;
  if (bodyLine) {
    let bodyPart = bodyLine.replace(/^body:\s*/i, '').trim();
    bodyPart = stripMarkdown(bodyPart);

    // Match "Register Discord with Discord ID: something"
    // or "Verify Discord: something"
    const match = bodyPart.match(/discord(?:\s+with\s+discord\s+id)?:\s*([^\s]+)/i);
    if (match) {
      discordName = match[1].trim();
    }
  }

  // 3) Status line → status
  const statusLine = lines.find(line => line.toLowerCase().startsWith('status:'));
  let status = 'Unknown';
  if (statusLine) {
    const parts = statusLine.split(':');
    status = (parts[1] || '').trim() || 'Unknown';
  }

  if (!redditName || !discordName) {
    console.log('⚠️ parseModmailMessage: Missing redditName or discordName. Full text was:');
    console.log(fullText);
    return null;
  }

  return {
    redditName,
    discordName,
    status,
  };
}

/**
 * Find latest matching modmail within LOOKBACK_HOURS
 * Conditions:
 *  - redditName matches redditNameInput
 *  - discordName matches the user who typed !verify (username or globalName)
 *  - status is not banned
 */
async function findMatchingModmail(modmailChannel, redditNameInput, member, lookbackHours) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const targetReddit = normalize(redditNameInput);

  const username = normalize(member.user.username);              // main username
  const globalName = normalize(member.user.globalName || '');    // global display name if set

  let lastId = undefined;
  let scanned = 0;
  const MAX_SCANNED = 500;

  while (true) {
    const batch = await modmailChannel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (batch.size === 0) break;

    // Newest → oldest
    for (const msg of batch.values()) {
      scanned++;
      if (scanned > MAX_SCANNED) {
        console.log('🔎 Reached max scanned messages');
        return null;
      }

      if (msg.createdTimestamp < cutoff) {
        console.log(`🔎 Stopping at messages older than ${lookbackHours} hours`);
        return null;
      }

      const fullText = buildFullTextFromMessage(msg);
      const parsed = parseModmailMessageFromFullText(fullText);
      if (!parsed) continue;

      const { redditName, discordName, status } = parsed;
      const parsedReddit = normalize(redditName);
      const parsedDiscord = normalize(discordName);

      if (status && status.toLowerCase().includes('banned')) {
        continue;
      }

      if (parsedReddit !== targetReddit) continue;

      let discordMatches = false;
      if (parsedDiscord === username) {
        discordMatches = true;
      } else if (globalName && parsedDiscord === globalName) {
        discordMatches = true;
      }

      if (!discordMatches) {
        console.log(
          `❌ Discord mismatch for u/${redditName}: ` +
          `modmailName=${discordName}, user.username=${member.user.username}, ` +
          `user.globalName=${member.user.globalName}`
        );
        continue;
      }

      console.log(`✅ Found latest matching modmail for u/${redditName} and ${member.user.tag}`);
      return { parsed, message: msg };
    }

    lastId = batch.last().id;
  }

  return null;
}

// ---- Handle !verify ----

async function handleVerifyCommand(message) {
  const args = message.content.trim().split(/\s+/);
  if (args.length < 2) {
    await message.reply('❌ Usage: `!verify <reddit_username>` or `!verify u/<reddit_username>`');
    return;
  }

  let redditNameInput = args[1];

  // Allow !verify u/RedditName
  if (redditNameInput.toLowerCase().startsWith('u/')) {
    redditNameInput = redditNameInput.substring(2);
  }

  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) {
    await message.reply('⚠️ I cannot find the guild. Please contact an admin.');
    return;
  }

  const modmailChannel = await client.channels.fetch(MODMAIL_CHANNEL_ID).catch(() => null);
  if (!modmailChannel || !modmailChannel.isTextBased()) {
    await message.reply('⚠️ Modmail channel is misconfigured. Please contact an admin.');
    return;
  }

  const member = message.member;
  if (!member) {
    await message.reply('⚠️ Could not resolve your member info. Try again or contact mods.');
    return;
  }

  await message.reply(
    `🔎 Searching last **${LOOKBACK_HOURS} hours** for a valid modmail for **u/${redditNameInput}** sent with your Discord name...`
  );

  const match = await findMatchingModmail(modmailChannel, redditNameInput, member, LOOKBACK_HOURS);

  if (!match) {
    await message.reply(
      `❌ I couldn't find a recent modmail that links **u/${redditNameInput}** to **your Discord username/global name** within the last **${LOOKBACK_HOURS} hours**.\n\n` +
      `Please:\n` +
      `1. Send a modmail in the exact format:\n` +
      `   \`Register Discord with Discord ID: ${member.user.username}\`\n` +
      `2. If you use a global display name, you can also use that instead.\n` +
      `3. Wait a few minutes, then run \`!verify ${redditNameInput}\` again in this channel.`
    );
    return;
  }

  const { parsed } = match;
  const { redditName, discordName, status } = parsed;

  if (status && status.toLowerCase().includes('banned')) {
    await message.reply(
      `🚫 There is a modmail entry for **u/${redditName}**, but the status is **${status}**.\n` +
      `Verification cannot proceed. Please contact the mod team if you believe this is a mistake.`
    );
    return;
  }

  // Assign role
  try {
    await member.roles.add(ROLE_ID);
    console.log(`✅ Added role ${ROLE_ID} to ${member.user.tag}`);
  } catch (err) {
    console.error('❌ Failed to add role:', err);
    await message.reply(
      `⚠️ I found a valid modmail for **u/${redditName}**, but I couldn't add the role (missing permissions or role order issue).\n` +
      `Please contact a moderator.`
    );
    return;
  }

  // Set nickname
  const newNick = `${redditName} | ${member.user.username}`;
  try {
    await member.setNickname(newNick);
    console.log(`✅ Set nickname of ${member.user.tag} → ${newNick}`);
  } catch (err) {
    console.error('⚠️ Failed to set nickname:', err);
    // Not fatal
  }

  const redditProfileUrl = `https://www.reddit.com/u/${redditName}`;

  await message.reply(
    `✅ Successfully verified **u/${redditName}** ↔ **${member.user.username}**.\n` +
    `🔗 Reddit profile: <${redditProfileUrl}>\n` +
    `Modmail Discord ID on file: **${discordName}**\n` +
    `Role assigned and nickname updated. Welcome!`
  );
}

// ---- Handle !reddit ----

async function handleRedditCommand(message) {
  // !reddit or !reddit @User
  const mentioned = message.mentions.members.first();
  let targetMember;

  if (mentioned) {
    targetMember = mentioned;
  } else {
    // self-lookup if no mention
    targetMember = message.member;
  }

  if (!targetMember) {
    await message.reply('❌ Could not resolve that user.');
    return;
  }

  const nickname = targetMember.displayName; // we set this to "RedditName | DiscordName"
  if (!nickname || !nickname.includes('|')) {
    await message.reply('❌ That user does not have a Reddit-linked nickname.');
    return;
  }

  const redditNameRaw = nickname.split('|')[0].trim();
  const redditName = redditNameRaw.toLowerCase().startsWith('u/')
    ? redditNameRaw.slice(2)
    : redditNameRaw;

  const url = `https://www.reddit.com/u/${redditName}`;

  await message.reply(
    `🔗 Reddit profile for **${redditName}** (looked up from nickname \`${nickname}\`):\n<${url}>`
  );
}

// ---- Events ----

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const contentLower = message.content.trim().toLowerCase();

  // Modmail channel: just log, no commands
  if (message.channelId === MODMAIL_CHANNEL_ID) {
    console.log('📨 Modmail forward received (stored for verification scan).');
    return;
  }

  // !reddit command – allowed in any channel (except modmail)
  if (contentLower.startsWith('!reddit')) {
    try {
      await handleRedditCommand(message);
    } catch (err) {
      console.error('❌ Error handling !reddit:', err);
      await message.reply('⚠️ Something went wrong while looking up Reddit profile.');
    }
    return;
  }

  // Verify channel: delete any non-!verify messages
  if (message.channelId === VERIFY_CHANNEL_ID) {
    if (!contentLower.startsWith('!verify')) {
      try {
        await message.delete();
        console.log(`🧹 Deleted non-verify message from ${message.author.tag} in verify channel.`);
      } catch (err) {
        console.error('⚠️ Failed to delete message in verify channel:', err);
      }
      return;
    }

    // Handle !verify in verify channel
    try {
      await handleVerifyCommand(message);
    } catch (err) {
      console.error('❌ Error handling !verify:', err);
      await message.reply('⚠️ Something went wrong while verifying. Please try again or contact a mod.');
    }
    return;
  }
});

client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`⏳ Lookback window: ${LOOKBACK_HOURS} hours`);

  // Apply slowmode to verify channel
  try {
    const verifyChannel = await client.channels.fetch(VERIFY_CHANNEL_ID);
    if (verifyChannel && verifyChannel.isTextBased()) {
      await verifyChannel.setRateLimitPerUser(VERIFY_SLOWMODE_SECONDS);
      console.log(
        `🐢 Set slowmode for verify channel (${verifyChannel.id}) to ${VERIFY_SLOWMODE_SECONDS} seconds.`
      );
    } else {
      console.log('⚠️ Could not apply slowmode: verify channel not found or not text-based.');
    }
  } catch (err) {
    console.error('⚠️ Failed to set slowmode on verify channel:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
