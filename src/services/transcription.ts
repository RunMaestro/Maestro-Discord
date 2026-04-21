import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { Attachment } from 'discord.js';
import { config } from '../config';

const execAsync = promisify(exec);

function quoteArg(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  return `"${escaped}"`;
}

async function runCommand(command: string): Promise<void> {
  try {
    await execAsync(command);
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
  return contentType.startsWith('audio/') || name.endsWith('.ogg');
}

export async function transcribeVoiceAttachment(attachment: Attachment): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `maestro-discord-voice-${randomUUID()}`);
  const inputPath = path.join(tempDir, 'input.ogg');
  const wavPath = path.join(tempDir, 'input.wav');
  const outputBase = path.join(tempDir, 'transcript');
  const outputTxtPath = `${outputBase}.txt`;

  await mkdir(tempDir, { recursive: true });
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Failed to download voice attachment: HTTP ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (audioBuffer.subarray(0, 4).toString('ascii') !== 'OggS') {
      throw new Error('Voice attachment is not a valid OGG/Opus file.');
    }
    await writeFile(inputPath, audioBuffer);

    await runCommand(
      `${quoteArg(config.ffmpegPath)} -y -i ${quoteArg(inputPath)} -ac 1 -ar 16000 -sample_fmt s16 ${quoteArg(wavPath)}`,
    );

    await runCommand(
      `${quoteArg(config.whisperCliPath)} -m ${quoteArg(config.whisperModelPath)} -f ${quoteArg(wavPath)} -otxt -of ${quoteArg(outputBase)}`,
    );

    const transcription = (await readFile(outputTxtPath, 'utf8')).trim();
    if (!transcription) {
      throw new Error(
        'Whisper returned an empty transcription (the audio may be silent or speech was not detected).',
      );
    }
    return transcription;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch((err) => {
      console.warn(`Failed to clean up temp transcription files at "${tempDir}":`, err);
    });
  }
}
