import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'fs/promises';
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

  await downloadAttachments(
    makeCollection(makeAttachment({ name: 'test.txt', url: 'https://cdn.example.com/test.txt', size: 100 })),
    tmpDir,
  );

  const dirStat = await stat(path.join(tmpDir, FILES_DIR));
  assert.ok(dirStat.isDirectory());
});

test('downloadAttachments saves files with timestamp-prefixed names', async () => {
  globalThis.fetch = () => Promise.resolve(okResponse('file content'));

  const results = await downloadAttachments(
    makeCollection(makeAttachment({ name: 'photo.png', url: 'https://cdn.example.com/photo.png', size: 500 })),
    tmpDir,
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].originalName, 'photo.png');
  assert.ok(results[0].savedPath.includes(FILES_DIR));

  // Filename should be {timestamp}-photo.png
  const basename = path.basename(results[0].savedPath);
  assert.match(basename, /^\d+-photo\.png$/);

  // File should contain the expected content
  const content = await readFile(results[0].savedPath, 'utf-8');
  assert.equal(content, 'file content');
});

test('downloadAttachments skips oversized attachments without throwing', async () => {
  globalThis.fetch = () => {
    throw new Error('fetch should not be called for oversized files');
  };

  const results = await downloadAttachments(
    makeCollection(makeAttachment({ name: 'huge.bin', url: 'https://cdn.example.com/huge.bin', size: MAX_FILE_SIZE + 1 })),
    tmpDir,
  );

  assert.equal(results.length, 0);
});

test('downloadAttachments skips failed fetches and continues', async () => {
  let callCount = 0;
  globalThis.fetch = () => {
    callCount++;
    if (callCount === 1) return Promise.resolve(failResponse(404));
    return Promise.resolve(okResponse('second file'));
  };

  const results = await downloadAttachments(
    makeCollection(
      makeAttachment({ name: 'missing.txt', url: 'https://cdn.example.com/missing.txt', size: 100 }),
      makeAttachment({ name: 'ok.txt', url: 'https://cdn.example.com/ok.txt', size: 100 }),
    ),
    tmpDir,
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].originalName, 'ok.txt');
});

test('downloadAttachments returns empty array for empty collection', async () => {
  const results = await downloadAttachments(makeCollection(), tmpDir);
  assert.deepEqual(results, []);
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
  const { mkdir, writeFile } = await import('fs/promises');
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
