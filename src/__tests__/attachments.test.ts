import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { Collection } from 'discord.js';
import type { Attachment } from 'discord.js';
import {
  downloadAttachments,
  formatAttachmentRefs,
  cleanupAgentFiles,
  MAX_FILE_SIZE,
  FILES_DIR,
  DownloadedFile,
  DownloadResult,
} from '../utils/attachments';

// --- Helpers ---

function makeAttachment(overrides: Partial<Attachment> & { name: string; url: string; size: number }): Attachment {
  return {
    contentType: 'application/octet-stream',
    ...overrides,
  } as unknown as Attachment;
}

function makeCollection(...items: Attachment[]): Collection<string, Attachment> {
  const col = new Collection<string, Attachment>();
  for (let i = 0; i < items.length; i++) {
    col.set(String(i), items[i]);
  }
  return col;
}

function okResponse(body: string | Buffer): Response {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  } as unknown as Response;
}

function failResponse(status: number): Response {
  return {
    ok: false,
    status,
    arrayBuffer: () => Promise.reject(new Error('should not be called')),
  } as unknown as Response;
}

// --- Test setup ---

let tmpDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'attachments-test-'));
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
  await rm(tmpDir, { recursive: true, force: true });
});

// --- Tests ---

test('downloadAttachments creates .maestro/discord-files/ directory', async () => {
  globalThis.fetch = () => Promise.resolve(okResponse('content'));

  const result = await downloadAttachments(
    makeCollection(makeAttachment({ name: 'test.txt', url: 'https://cdn.example.com/test.txt', size: 100 })),
    tmpDir,
  );

  const dirStat = await stat(path.join(tmpDir, FILES_DIR));
  assert.ok(dirStat.isDirectory());
  assert.equal(result.downloaded.length, 1);
  assert.deepEqual(result.failed, []);
});

test('downloadAttachments saves files with UUID-prefixed names', async () => {
  globalThis.fetch = () => Promise.resolve(okResponse('file content'));

  const { downloaded, failed } = await downloadAttachments(
    makeCollection(makeAttachment({ name: 'photo.png', url: 'https://cdn.example.com/photo.png', size: 500 })),
    tmpDir,
  );

  assert.equal(downloaded.length, 1);
  assert.deepEqual(failed, []);
  assert.equal(downloaded[0].originalName, 'photo.png');
  assert.ok(downloaded[0].savedPath.includes(FILES_DIR));

  // Filename should be {uuid}-photo.png
  const basename = path.basename(downloaded[0].savedPath);
  assert.match(basename, /^[0-9a-f-]{36}-photo\.png$/);

  // File should contain the expected content
  const content = await readFile(downloaded[0].savedPath, 'utf-8');
  assert.equal(content, 'file content');
});

test('downloadAttachments skips oversized attachments and reports them as failed', async () => {
  globalThis.fetch = () => {
    throw new Error('fetch should not be called for oversized files');
  };

  const { downloaded, failed } = await downloadAttachments(
    makeCollection(makeAttachment({ name: 'huge.bin', url: 'https://cdn.example.com/huge.bin', size: MAX_FILE_SIZE + 1 })),
    tmpDir,
  );

  assert.equal(downloaded.length, 0);
  assert.deepEqual(failed, ['huge.bin']);
});

test('downloadAttachments skips failed fetches, reports them, and continues', async () => {
  let callCount = 0;
  globalThis.fetch = () => {
    callCount++;
    if (callCount === 1) return Promise.resolve(failResponse(404));
    return Promise.resolve(okResponse('second file'));
  };

  const { downloaded, failed } = await downloadAttachments(
    makeCollection(
      makeAttachment({ name: 'missing.txt', url: 'https://cdn.example.com/missing.txt', size: 100 }),
      makeAttachment({ name: 'ok.txt', url: 'https://cdn.example.com/ok.txt', size: 100 }),
    ),
    tmpDir,
  );

  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].originalName, 'ok.txt');
  assert.deepEqual(failed, ['missing.txt']);
});

test('downloadAttachments returns empty result for empty collection', async () => {
  const result = await downloadAttachments(makeCollection(), tmpDir);
  assert.deepEqual(result, { downloaded: [], failed: [] });
});

test('formatAttachmentRefs produces correct format', () => {
  const files: DownloadedFile[] = [
    { originalName: 'a.txt', savedPath: '/home/agent/files/123-a.txt' },
    { originalName: 'b.png', savedPath: '/home/agent/files/456-b.png' },
  ];
  const result = formatAttachmentRefs(files);
  assert.equal(result, '[Attached: /home/agent/files/123-a.txt]\n[Attached: /home/agent/files/456-b.png]');
});

test('formatAttachmentRefs returns empty string for empty array', () => {
  assert.equal(formatAttachmentRefs([]), '');
});

// --- cleanupAgentFiles tests ---

test('cleanupAgentFiles removes the discord-files directory', async () => {
  // Create the directory structure with a file inside
  const filesDir = path.join(tmpDir, FILES_DIR);
  await mkdir(filesDir, { recursive: true });
  await writeFile(path.join(filesDir, 'test.txt'), 'content');

  await cleanupAgentFiles(tmpDir);

  // Directory should no longer exist
  await assert.rejects(() => stat(path.join(tmpDir, FILES_DIR)), { code: 'ENOENT' });
});

test('cleanupAgentFiles does not throw if directory does not exist', async () => {
  // tmpDir exists but has no .maestro/discord-files/ subdirectory
  await assert.doesNotReject(() => cleanupAgentFiles(tmpDir));
});

test('downloadAttachments reports all files as failed when mkdir fails', async () => {
  // Use a file path as cwd so mkdir(<file>/...) fails deterministically
  const fileAsCwd = path.join(tmpDir, 'not-a-directory');
  await writeFile(fileAsCwd, 'x');

  const { downloaded, failed } = await downloadAttachments(
    makeCollection(
      makeAttachment({ name: 'a.txt', url: 'https://cdn.example.com/a.txt', size: 100 }),
      makeAttachment({ name: 'b.txt', url: 'https://cdn.example.com/b.txt', size: 100 }),
    ),
    fileAsCwd,
  );

  assert.equal(downloaded.length, 0);
  assert.deepEqual(failed, ['a.txt', 'b.txt']);
});

test('downloadAttachments handles partial failures — downloads successes and reports failures', async () => {
  let callCount = 0;
  globalThis.fetch = () => {
    callCount++;
    if (callCount === 2) return Promise.reject(new Error('network error'));
    return Promise.resolve(okResponse(`content-${callCount}`));
  };

  const { downloaded, failed } = await downloadAttachments(
    makeCollection(
      makeAttachment({ name: 'first.txt', url: 'https://cdn.example.com/first.txt', size: 100 }),
      makeAttachment({ name: 'broken.txt', url: 'https://cdn.example.com/broken.txt', size: 100 }),
      makeAttachment({ name: 'third.txt', url: 'https://cdn.example.com/third.txt', size: 100 }),
    ),
    tmpDir,
  );

  assert.equal(downloaded.length, 2);
  assert.equal(downloaded[0].originalName, 'first.txt');
  assert.equal(downloaded[1].originalName, 'third.txt');
  assert.deepEqual(failed, ['broken.txt']);
});
