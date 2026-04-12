import { mkdir, rm, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
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
export interface DownloadResult {
  downloaded: DownloadedFile[];
  failed: string[]; // original names of files that failed
}

export async function downloadAttachments(
  attachments: Collection<string, Attachment>,
  agentCwd: string,
): Promise<DownloadResult> {
  const targetDir = path.join(agentCwd, FILES_DIR);
  try {
    await mkdir(targetDir, { recursive: true });
  } catch (err) {
    console.warn(`[attachments] Failed to create directory "${targetDir}":`, err);
    return { downloaded: [], failed: [...attachments.values()].map((a) => a.name) };
  }

  const downloaded: DownloadedFile[] = [];
  const failed: string[] = [];

  for (const [, attachment] of attachments) {
    if (attachment.size > MAX_FILE_SIZE) {
      console.warn(
        `[attachments] Skipping "${attachment.name}" (${attachment.size} bytes) — exceeds ${MAX_FILE_SIZE} byte limit`,
      );
      failed.push(attachment.name);
      continue;
    }

    const safeName = path.basename(attachment.name);
    const filename = `${randomUUID()}-${safeName}`;
    const savedPath = path.join(targetDir, filename);

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        console.warn(
          `[attachments] Failed to download "${attachment.name}": HTTP ${response.status}`,
        );
        failed.push(attachment.name);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(savedPath, buffer);
      downloaded.push({ originalName: attachment.name, savedPath });
    } catch (err) {
      console.warn(`[attachments] Error downloading "${attachment.name}":`, err);
      failed.push(attachment.name);
    }
  }

  return { downloaded, failed };
}

/**
 * Remove the `.maestro/discord-files/` directory for an agent.
 * Silently succeeds if the directory doesn't exist.
 */
export async function cleanupAgentFiles(agentCwd: string): Promise<void> {
  const dir = path.join(agentCwd, FILES_DIR);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Removal failed (e.g., permission error) — nothing to do
  }
}

/**
 * Format downloaded files as "[Attached: /path]" lines for inclusion in messages.
 * Returns empty string if no files.
 */
export function formatAttachmentRefs(files: DownloadedFile[]): string {
  if (files.length === 0) return '';
  return files.map((f) => `[Attached: ${f.savedPath}]`).join('\n');
}
