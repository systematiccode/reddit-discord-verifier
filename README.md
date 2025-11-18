# 📘 Reddit → Discord Verification Bot

A Discord bot that verifies Reddit users based on modmail forwarded messages.  
Designed for subreddits that need secure, two-way identity verification between Reddit and Discord.

---

## 🚀 Features

### 🔐 Two-way verification system
- User sends Reddit modmail in the format:
  ```text
  Register Discord with Discord ID: <discordUsername>
  ```
- User then types in Discord:
  ```text
  !verify <RedditName>
  ```
- Bot compares:
  - Reddit name from modmail  
  - Discord name in modmail  
  - Command invoker’s real Discord username  
- If all match → grants verified role + sets nickname.

### 🔎 Modmail scanning
- Looks back **X hours** (configurable).
- Always uses the **most recent** matching modmail.
- Automatically filters out:
  - Wrong formats
  - Banned users
  - Non-matching Discord names

### 🗑️ Verify channel moderation
- Automatically **deletes all non-verify messages** in the verify channel.
- Automatically **enforces slowmode** for that channel.
- Keeps the channel clean and functional.

### 🔗 Reddit profile lookup
Users can run:
```text
!reddit @User
```
Bot extracts RedditName from nickname (`RedditName | DiscordName`)  
and returns a clickable Reddit profile link.

### 🧩 Configurable via `.env`
- Channel IDs  
- Role ID  
- Lookback hours  
- Slowmode duration  

### 🏃 Runs almost anywhere
- macOS  
- Synology NAS (native Node or Docker)  
- VPS (Ubuntu, Debian, etc.)  
- Raspberry Pi  
- Works nicely with PM2

---

## 📦 Requirements

- Node.js 20+ recommended  
- Discord bot token  
- A Discord server (guild)  
- A channel where Reddit modmail is forwarded  
- A verify command channel  
- A “Verified” role (or equivalent)

---

## 📁 Folder Structure

```text
reddit-discord-verifier/
│
├── index.js             # Main bot logic
├── package.json
├── .gitignore
├── .env.example         # Placeholder env template (safe for Git)
└── README.md
```

---

## ⚙️ Installation

### 1️⃣ Clone the repository

```bash
git clone https://github.com/YOURNAME/reddit-discord-verifier.git
cd reddit-discord-verifier
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Create your real `.env` file

```bash
cp .env.example .env
nano .env
```

Fill in your real values (see next section).

### 4️⃣ Start the bot

```bash
npm start
```

You should see logs like:

```text
🤖 Logged in as RedditVerifierBot#1234
⏳ Lookback window: 12 hours
```

---

## 🔐 Environment Variables (`.env`)

The repo includes a **`.env.example`** you can copy:

```bash
cp .env.example .env
```

Then edit `.env` and replace the placeholders:

```env
# ==========================
# Discord bot auth
# ==========================

# Bot token from Discord Developer Portal (Bot → Reset Token)
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE

# Main guild (server) ID where the bot runs
GUILD_ID=123456789012345678

# ==========================
# Channels & roles
# ==========================

# Channel where Reddit modmail is forwarded (Devvit bot output)
WATCH_CHANNEL_ID=123456789012345678

# Channel where users run !verify
VERIFY_COMMAND_CHANNEL_ID=123456789012345678

# Role ID to assign when a user is verified
ROLE_ID=123456789012345678

# ==========================
# Behaviour config
# ==========================

# How many hours back to look for modmail when !verify is used
MODMAIL_LOOKBACK_HOURS=12

# Slowmode for the verify channel (seconds per user)
VERIFY_SLOWMODE_SECONDS=30
```

> ⚠️ Do **not** commit your real `.env` to Git. Only `.env.example` should be tracked.

---

## 🧪 Commands

### `!verify <RedditName>`

Example:

```text
!verify Hermit_Toad
```

What it does:

1. Scans the configured modmail channel for the **last X hours**.
2. Looks for a forwarded modmail entry with:
   - `Author: <RedditName>`
   - `Body: Register Discord with Discord ID: <discordUsername>`
   - `Status: Active` (not banned)
3. Confirms the Discord name from modmail matches the user who ran `!verify`.
4. If valid:
   - Adds the configured role (e.g., `Verified`).
   - Sets the user’s nickname to:
     ```text
     RedditName | DiscordName
     ```
   - Responds with a success message and Reddit profile link.

If no valid match is found, the bot tells the user how to send a correct modmail.

---

### `!reddit @User`

Example:

```text
!reddit @Hermit_Toad
```

What it does:

- Reads the user’s nickname, expected format:
  ```text
  RedditName | DiscordName
  ```
- Extracts `RedditName` from the nickname.
- Replies with their Reddit profile link:
  ```text
  https://www.reddit.com/u/RedditName
  ```

If the user does not have a Reddit-formatted nickname, the bot lets you know.

- If no user is mentioned (`!reddit` alone), it defaults to **self-lookup**.

---

## 🗑️ Verify Channel Behaviour

In the **verify channel** (configured via `VERIFY_COMMAND_CHANNEL_ID`):

- The bot **deletes any message** that does **not** start with `!verify`.
- This keeps the channel clean and focused.
- Slowmode is automatically applied (via `VERIFY_SLOWMODE_SECONDS`).

In the **modmail channel** (configured via `WATCH_CHANNEL_ID`):

- The bot does **not** post messages.
- It only **reads** forwarded modmail to validate verification requests.

---

## 🏃 Running with PM2 (recommended for NAS / VPS)

Install PM2 globally:

```bash
npm install -g pm2
```

From the bot folder:

```bash
pm2 start index.js --name reddit-discord-bot
pm2 save
pm2 startup
```

To update:

```bash
cd ~/bots/reddit-discord-verifier
git pull
pm2 restart reddit-discord-bot
```

Check logs:

```bash
pm2 logs reddit-discord-bot
```

---

## 🐳 Docker (optional)

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "index.js"]
```

Build + run:

```bash
docker build -t reddit-verifier .
docker run -d --env-file .env reddit-verifier
```

---

## 🧰 Developer Notes

### Environment validation

On startup, the bot checks for missing required env vars:

- DISCORD_TOKEN
- GUILD_ID
- WATCH_CHANNEL_ID
- VERIFY_COMMAND_CHANNEL_ID
- ROLE_ID

If any are missing, it logs an error and exits, reminding you to copy `.env.example` → `.env`.

### Message parsing

The bot parses forwarded modmail from:

- message.content
- message.embeds[].description
- message.embeds[].fields[]

It looks for lines like:

- Author: ...
- Body: ...
- Status: ...

and extracts:

- redditName
- discordName
- status

---

## 🆘 Troubleshooting

### Bot starts but doesn’t respond

- Check that it’s actually online in Discord.
- Confirm the bot has required permissions:
  - Manage Roles
  - Manage Channels
  - Manage Nicknames
  - Manage Messages
  - Read Message History
  - View Channels
- Ensure Message Content Intent and Server Members Intent are enabled in the Developer Portal.

### `Missing Permissions` errors

- Bot’s role must be **higher** than the role it assigns.
- Bot must have **Manage Roles** to add the verified role.
- Bot must have **Manage Nicknames** to set nicknames.
- Bot must have **Manage Channels** to set slowmode.

### Verify not working / “No valid modmail found”

- Ensure the forwarded modmail uses exactly:
  ```text
  Register Discord with Discord ID: <discordUsername>
  ```
- Ensure the user’s **Discord username** (or global name, depending on your setup) matches what they sent via modmail.
- Ensure the modmail is within the configured `MODMAIL_LOOKBACK_HOURS` window.

---

## ❤️ Contributions

Feel free to fork, tweak, and open PRs with:

- New commands (e.g., `!whois`, `!forceverify`)
- Extra safety checks
- Support for multiple subreddits / servers

This project is meant to be a practical, opinionated starter for safe Reddit ↔ Discord identity verification.
