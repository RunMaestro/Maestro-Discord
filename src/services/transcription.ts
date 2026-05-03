import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { mkdir, readFile, rm, writeFile, access } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { MessageFlags } from 'discord.js';
import type { Attachment, Message } from 'discord.js';
import { config } from '../config';
import { logger } from './logger';

// Hard cap on a single voice attachment's size before we attempt to download
// and transcode it. Discord voice messages are short (≤ 10 min) and small in
// practice; this keeps a stray oversized .ogg from blocking the per-channel
// queue on a 5-minute ffmpeg/whisper run.
export const MAX_VOICE_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const execFileAsync = promisify(execFile);

let transcriberAvailable = false;
let resolvedFfmpegPath: string | null = null;
let resolvedWhisperCliPath: string | null = null;

async function resolveExecutable(configPath: string, executableName: string): Promise<string> {
  const isAbsolutePath = path.isAbsolute(configPath);

  if (isAbsolutePath) {
    // Validate explicit path is executable
    await access(configPath, constants.X_OK);
    return configPath;
  }

  // Bare command name: probe via execution to use OS PATH resolution
  try {
    await execFileAsync(configPath, ['--help'], { timeout: 5000 });
    return configPath;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    // Only fail if executable is truly missing or not executable
    if (e.code === 'ENOENT' || e.code === 'EACCES') {
      throw new Error(`Could not resolve ${executableName} in PATH or as executable`);
    }
    // If it ran but exited with non-zero, the executable exists
    return configPath;
  }
}

export function getResolvedFfmpegPath(): string {
  return resolvedFfmpegPath || config.ffmpegPath;
}

export function getResolvedWhisperCliPath(): string {
  return resolvedWhisperCliPath || config.whisperCliPath;
}

export function isTranscriberAvailable(): boolean {
  return transcriberAvailable;
}

export async function checkTranscriptionDependencies(): Promise<void> {
  const missing: string[] = [];

  // Check and resolve ffmpeg executable
  try {
    resolvedFfmpegPath = await resolveExecutable(config.ffmpegPath, 'ffmpeg');
  } catch {
    missing.push(`ffmpeg (${config.ffmpegPath})`);
  }

  // Check and resolve whisper-cli executable
  try {
    resolvedWhisperCliPath = await resolveExecutable(config.whisperCliPath, 'whisper-cli');
  } catch {
    missing.push(`whisper-cli (${config.whisperCliPath})`);
  }

  // Check whisper model file
  try {
    await access(config.whisperModelPath);
  } catch {
    missing.push(`whisper model (${config.whisperModelPath})`);
  }

  if (missing.length > 0) {
    console.warn(
      `⚠️ Transcription disabled: missing dependencies: ${missing.join(', ')}. ` +
      'Voice message transcription will be unavailable. See README for setup instructions.',
    );
    transcriberAvailable = false;
  } else {
    console.info('✅ Voice transcription enabled.');
    transcriberAvailable = true;
  }
}

async function runCommand(executable: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(executable, args, { timeout: 300000, killSignal: 'SIGKILL' });
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string; stdout?: string; code?: number | string };
    const detail = [e.code ? `exit code: ${e.code}` : '', e.stderr?.trim(), e.stdout?.trim()]
      .filter(Boolean)
      .join(' | ');
    throw new Error(`${e.message ?? 'Command failed'}${detail ? ` (${detail})` : ''}`, {
      cause: err,
    });
  }
}

export function isVoiceMessage(message: Pick<Message, 'flags'>): boolean {
  return !!message.flags?.has(MessageFlags.IsVoiceMessage);
}

export function isVoiceAttachment(attachment: Attachment): boolean {
  const contentType = attachment.contentType?.toLowerCase() ?? '';
  const name = attachment.name.toLowerCase();
  return contentType === 'audio/ogg' || name.endsWith('.ogg');
}

export async function transcribeVoiceAttachment(attachment: Attachment): Promise<string> {
  if (typeof attachment.size === 'number' && attachment.size > MAX_VOICE_ATTACHMENT_BYTES) {
    throw new Error(
      `Voice attachment is ${attachment.size} bytes, exceeds limit of ${MAX_VOICE_ATTACHMENT_BYTES} bytes.`,
    );
  }

  const tempDir = path.join(os.tmpdir(), `maestro-discord-voice-${randomUUID()}`);
  const inputPath = path.join(tempDir, 'input.ogg');
  const wavPath = path.join(tempDir, 'input.wav');
  const outputBase = path.join(tempDir, 'transcript');
  const outputTxtPath = `${outputBase}.txt`;

  await mkdir(tempDir, { recursive: true });
  try {
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      throw new Error(`Failed to download voice attachment: HTTP ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    await writeFile(inputPath, audioBuffer);

    await runCommand(getResolvedFfmpegPath(), [
      '-y',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-sample_fmt',
      's16',
      wavPath,
    ]);

    await runCommand(getResolvedWhisperCliPath(), [
      '-m',
      config.whisperModelPath,
      '-l',
      config.whisperLanguage,
      '-f',
      wavPath,
      '-otxt',
      '-of',
      outputBase,
    ]);

    const transcription = (await readFile(outputTxtPath, 'utf8')).trim();
    if (!transcription) {
      throw new Error(
        'Whisper returned an empty transcription (the audio may be silent or speech was not detected).',
      );
    }
    return transcription;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch((err) => {
      logger.error('transcription', `Failed to clean up temp transcription files at "${tempDir}": ${err.message || err}`);
    });
  }
}
