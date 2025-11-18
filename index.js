import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from 'discord.js';

const {
  DISCORD_TOKEN,
  GUILD_ID,
  WATCH_CHANNEL_ID,
  ROLE_ID,
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !WATCH_CHANNEL_ID || !ROLE_ID) {
  console.error('❌ Missing env vars: DISCORD_TOKEN, GUILD_ID, WATCH_CHANNEL_ID, ROLE_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Helper: extract all visible text (content + embeds)
function getMessageText(message) {
  let parts = [];

  if (message.content) {
    parts.push(message.content);
  }

  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.title) parts.push(embed.title);
      if (embed.description) parts.push(embed.description);
      if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
          if (field.name) parts.push(field.name);
          if (field.value) parts.push(field.value);
        }
      }
    }
  }

  return parts.join('\n');
}

// Helper: strip basic Markdown / formatting from text
function stripFormatting(text) {
  if (!text) return '';

  return text
    // [**Hermit_Toad**](https://...) -> **Hermit_Toad**
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // **bold** -> bold
    .replace(/\*\*/g, '')
    // inline code `foo` -> foo
    .replace(/`/g, '')
    .trim();
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild) return;
    if (message.channel.id !== WATCH_CHANNEL_ID) return;
    if (message.author.id === client.user.id) return;

    const rawText = getMessageText(message);
    const content = stripFormatting(rawText);

    console.log('--- RAW TEXT I SEE ---');
    console.log(rawText);
    console.log('--- STRIPPED TEXT I USE ---');
    console.log(content);
    console.log('-----------------------------');

    // 0) Check Status line — skip if Status: Banned
    // After stripping, this should look like: Status: Active  / Status: Banned
    const statusMatch = content.match(/Status:\s*([^\n\r]+)/i);
    if (statusMatch) {
      const statusValue = statusMatch[1].trim().toLowerCase();
      if (statusValue.includes('banned')) {
        console.log('⛔ Status is Banned, ignoring this verification.');
        return;
      }
    }

    // 1) Parse Reddit username
    // Prefer Participant: line if present, else Author:, else first line
    let redditUser = null;

    const participantMatch = content.match(/Participant:\s*([^\n\r]+)/i);
    if (participantMatch) {
      redditUser = participantMatch[1].trim();
    } else {
      const authorMatch = content.match(/Author:\s*([^\n\r]+)/i);
      if (authorMatch) {
        redditUser = authorMatch[1].trim();
      }
    }

    let fallbackRedditUser = null;
    const firstLineMatch = content.match(/^([^\n\r]+)/);
    if (firstLineMatch) {
      fallbackRedditUser = firstLineMatch[1].trim();
    }

    const finalRedditUser = redditUser || fallbackRedditUser || 'RedditUser';

    // 2) Parse Discord username from the Body line
    // Now stripped, it should look like:
    // Body: Register Discord with Discord ID: pikachucatcher88
    // or:
    // Body: Verify Discord: someName

    let discordName = null;

    const verifyMatch = content.match(
      /Body:\s*Verify Discord:\s*([^\s]+)/i
    );

    const registerMatch = content.match(
      /Body:\s*Register Discord with Discord ID:\s*([^\s]+)/i
    );

    if (verifyMatch) {
      discordName = verifyMatch[1].trim();
    } else if (registerMatch) {
      discordName = registerMatch[1].trim();
    }

    if (!discordName) {
      console.log('No matching "Verify Discord" or "Register Discord" line found, skipping.');
      return;
    }

    console.log(`Detected Reddit user: ${finalRedditUser} | Discord name: ${discordName}`);

    const guild = message.guild;

    // 3) Try to find the member by username or display name
    let targetMember =
      guild.members.cache.find(
        (m) =>
          m.user.username.toLowerCase() === discordName.toLowerCase() ||
          (m.displayName && m.displayName.toLowerCase() === discordName.toLowerCase())
      ) || null;

    // If not in cache, try a broader fetch by query
    if (!targetMember) {
      try {
        const fetched = await guild.members.fetch({
          query: discordName,
          limit: 10,
        });

        targetMember = fetched.find(
          (m) =>
            m.user.username.toLowerCase() === discordName.toLowerCase() ||
            (m.displayName && m.displayName.toLowerCase() === discordName.toLowerCase())
        );

        if (!targetMember && fetched.size > 0) {
          console.log('No exact match, using first fetched member as fallback.');
          targetMember = fetched.first();
        }
      } catch (err) {
        console.error('Error fetching members:', err);
      }
    }

    if (!targetMember) {
      console.warn(`⚠️ Could not find a member matching "${discordName}" in the guild.`);
      await message.reply(
        `I couldn't find a member with the name \`${discordName}\`. Please check their Discord username / display name.`
      ).catch(() => {});
      return;
    }

    console.log(`Found member: ${targetMember.user.tag}`);

    // 4) Get the role
    const role = guild.roles.cache.get(ROLE_ID);
    if (!role) {
      console.error('❌ Role not found, check ROLE_ID');
      return;
    }

    // 5) Assign the role
    if (!targetMember.roles.cache.has(ROLE_ID)) {
      try {
        await targetMember.roles.add(role, 'Verified via Reddit modmail');
        console.log(`✅ Added role ${role.name} to ${targetMember.user.tag}`);
      } catch (err) {
        console.error(`Failed to add role to ${targetMember.user.tag}:`, err);
      }
    } else {
      console.log(`Member ${targetMember.user.tag} already has role ${role.name}`);
    }

    // 6) Set nickname to "Reddit | Discord"
    const newNick = `${finalRedditUser} | ${discordName}`;
    try {
      await targetMember.setNickname(newNick, 'Set from Reddit verification');
      console.log(`✅ Set nickname of ${targetMember.user.tag} → ${newNick}`);
    } catch (err) {
      console.error(`Failed to set nickname for ${targetMember.user.tag}:`, err);
    }

    // Optional feedback message
    await message.reply(
      `✅ Linked Reddit **${finalRedditUser}** to Discord **${targetMember.user.tag}** and assigned role **${role.name}**.`
    ).catch(() => {});
  } catch (err) {
    console.error('Error in MessageCreate handler:', err);
  }
});

client.login(DISCORD_TOKEN);
