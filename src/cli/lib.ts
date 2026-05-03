import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SendApiPayload {
  agentId: string;
  message: string;
  mention?: boolean;
}

export interface SendApiResult {
  success: boolean;
  channelId?: string;
  error?: string;
}

export const DEFAULT_PORT = 3457;

export function postToSendApi(payload: SendApiPayload, port: number): Promise<SendApiResult> {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks) as SendApiResult);
          } catch {
            reject(new Error('Invalid response from bot'));
          }
        });
      },
    );

    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(new Error('Bot is not running or API server is not started'));
      } else {
        reject(err);
      }
    });

    req.write(body);
    req.end();
  });
}

export async function runMaestroCli(args: string[], timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execFileAsync('maestro-cli', args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export function fail(message: string, code = 1): never {
  console.error(`Error: ${message}`);
  process.exit(code);
}

export function ok(result: SendApiResult): never {
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}
