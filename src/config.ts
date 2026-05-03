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
  get token() {
    return required('DISCORD_BOT_TOKEN');
  },
  get clientId() {
    return required('DISCORD_CLIENT_ID');
  },
  get guildId() {
    return required('DISCORD_GUILD_ID');
  },
  get allowedUserIds() {
    return requiredCsv('DISCORD_ALLOWED_USER_IDS');
  },
  get apiPort() {
    return parseInt(process.env.API_PORT || '3457', 10);
  },
  get mentionUserId() {
    return process.env.DISCORD_MENTION_USER_ID || '';
  },
  get ffmpegPath() {
    return process.env.FFMPEG_PATH || 'ffmpeg';
  },
  get whisperCliPath() {
    return process.env.WHISPER_CLI_PATH || 'whisper-cli';
  },
  get whisperModelPath() {
    return process.env.WHISPER_MODEL_PATH || 'models/ggml-base.en.bin';
  },
  get whisperLanguage() {
    return process.env.WHISPER_LANGUAGE || 'auto';
  },
};
