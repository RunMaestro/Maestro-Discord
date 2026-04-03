import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { Collection, Attachment } from 'discord.js';

export interface DownloadedFile {
  originalName: string;
  savedPath: string; // absolute path
}

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
export const FILES_DIR = '.maestro/discord-files';

/**
 * Download Discord attachments to the agent's working directory.
 * Returns an array of successfully downloaded files (never throws).
 */
export async function downloadAttachments(
  attachments: Collection<string, Attachment>,
  agentCwd: string,
): Promise<DownloadedFile[]> {
  const targetDir = path.join(agentCwd, FILES_DIR);
  await mkdir(targetDir, { recursive: true });

  const results: DownloadedFile[] = [];

  for (const [, attachment] of attachments) {
    if (attachment.size > MAX_FILE_SIZE) {
      console.warn(
        `[attachments] Skipping "${attachment.name}" (${attachment.size} bytes) — exceeds ${MAX_FILE_SIZE} byte limit`,
      );
      continue;
    }

    const filename = `${Date.now()}-${attachment.name}`;
    const savedPath = path.join(targetDir, filename);

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        console.warn(
          `[attachments] Failed to download "${attachment.name}": HTTP ${response.status}`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(savedPath, buffer);
      results.push({ originalName: attachment.name, savedPath });
    } catch (err) {
      console.warn(`[attachments] Error downloading "${attachment.name}":`, err);
    }
  }

  return results;
}

/**
 * Format downloaded files as "[Attached: /path]" lines for inclusion in messages.
 * Returns empty string if no files.
 */
export function formatAttachmentRefs(files: DownloadedFile[]): string {
  if (files.length === 0) return '';
  return files.map((f) => `[Attached: ${f.savedPath}]`).join('\n');
}
