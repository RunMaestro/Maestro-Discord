import dotenv from 'dotenv';
dotenv.config();

export function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function requiredCsv(key: string): string[] {
  const val = process.env[key];
  if (!val) return [];

  return val
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export const config = {
  token: required('DISCORD_BOT_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  allowedUserIds: requiredCsv('DISCORD_ALLOWED_USER_IDS'),
};
