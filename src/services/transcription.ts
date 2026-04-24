import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile, access } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { Attachment } from 'discord.js';
import { config } from '../config';
import { logger } from './logger';

let transcriberAvailable = false;

export function isTranscriberAvailable(): boolean {
  return transcriberAvailable;
}

export async function checkTranscriptionDependencies(): Promise<void> {
  const checks = [
    { name: 'ffmpeg', path: config.ffmpegPath },
    { name: 'whisper-cli', path: config.whisperCliPath },
    { name: 'whisper model', path: config.whisperModelPath },
  ];

  const missing: string[] = [];
  for (const check of checks) {
    try {
      await access(check.path);
    } catch {
      missing.push(`${check.name} (${check.path})`);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `⚠️ Transcription disabled: missing dependencies: ${missing.join(', ')}. ` +
      'Voice message transcription will be unavailable. See README for setup instructions.',
    );
    transcriberAvailable = false;
  } else {
    console.warn('✅ Voice transcription enabled.');
    transcriberAvailable = true;
  }
}

const execFileAsync = promisify(execFile);

async function runCommand(executable: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(executable, args);
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

export function isVoiceAttachment(attachment: Attachment): boolean {
  const contentType = attachment.contentType?.toLowerCase() ?? '';
  const name = attachment.name.toLowerCase();
  return contentType === 'audio/ogg' || name.endsWith('.ogg');
}

export async function transcribeVoiceAttachment(attachment: Attachment): Promise<string> {
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

    await runCommand(config.ffmpegPath, [
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

    await runCommand(config.whisperCliPath, [
      '-m',
      config.whisperModelPath,
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
      logger.error(`Failed to clean up temp transcription files at "${tempDir}":`, err);
    });
  }
}
