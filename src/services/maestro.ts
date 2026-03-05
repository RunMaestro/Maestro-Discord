import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// --- Types ---

export interface MaestroAgent {
  id: string;
  name: string;
  toolType: string;
  cwd: string;
  [key: string]: unknown;
}

export interface MaestroSession {
  sessionId: string;
  sessionName: string;
  modifiedAt: string;
  firstMessage: string;
  messageCount: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationSeconds: number;
  starred: boolean;
}

export interface SendResult {
  agentId: string;
  agentName: string;
  sessionId: string;
  response: string;
  success: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    totalCostUsd: number;
    contextWindow: number;
    contextUsagePercent: number;
  };
}

// --- Helpers ---

async function run(args: string[]): Promise<string> {
  try {
    const { stdout } = (await execFileAsync('maestro-cli', args, {
      timeout: 5 * 60 * 1000, // 5 min timeout for long agent responses
    })) as { stdout: string; stderr: string };
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    const detail = e.stderr?.trim() || e.stdout?.trim() || e.message || String(err);
    throw new Error(`maestro-cli ${args[0]} failed: ${detail}`);
  }
}

// --- Service ---

export const maestro = {
  /** Check if maestro-cli is installed and reachable */
  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync('maestro-cli', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  },

  /** List all agents. Returns empty array on error. */
  async listAgents(): Promise<MaestroAgent[]> {
    const raw = await run(['list', 'agents', '--json']);
    return JSON.parse(raw) as MaestroAgent[];
  },

  /** List sessions for a given agent */
  async listSessions(agentId: string, limit = 25): Promise<MaestroSession[]> {
    const raw = await run(['list', 'sessions', agentId, '--json', '-l', String(limit)]);
    return JSON.parse(raw) as MaestroSession[];
  },

  /**
   * Send a message to an agent.
   * If sessionId is provided, resumes that session; otherwise starts a new one.
   * Returns the full structured response.
   */
  async send(agentId: string, message: string, sessionId?: string): Promise<SendResult> {
    const args = ['send', agentId, message];
    if (sessionId) args.push('-s', sessionId);
    const raw = await run(args);
    return JSON.parse(raw) as SendResult;
  },
};
