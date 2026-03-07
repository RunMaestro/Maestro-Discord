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

export interface MaestroPlaybook {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  taskCount: number;
  agentId?: string;
  agentName?: string;
  [key: string]: unknown;
}

export interface MaestroPlaybookDetail extends MaestroPlaybook {
  documents: Array<{
    path: string;
    taskCount: number;
    completedCount: number;
  }>;
}

export interface PlaybookEvent {
  type: 'start' | 'document_start' | 'task_start' | 'task_complete' | 'document_complete' | 'loop_complete' | 'complete';
  timestamp: number;
  success?: boolean;
  summary?: string;
  totalTasksCompleted?: number;
  totalElapsedMs?: number;
  totalCost?: number;
  [key: string]: unknown;
}

// --- Helpers ---

async function run(args: string[]): Promise<string> {
  try {
    const { stdout } = (await execFileAsync('maestro-cli', args, {
      timeout: 30 * 60 * 1000, // 30 min timeout for playbook runs
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

  /** List all playbooks, optionally filtered by agent */
  async listPlaybooks(agentId?: string): Promise<MaestroPlaybook[]> {
    const args = ['list', 'playbooks', '--json'];
    if (agentId) args.push('-a', agentId);
    const raw = await run(args);
    return JSON.parse(raw) as MaestroPlaybook[];
  },

  /** Show detailed info for a single playbook */
  async showPlaybook(playbookId: string): Promise<MaestroPlaybookDetail> {
    const raw = await run(['show', 'playbook', playbookId, '--json']);
    return JSON.parse(raw) as MaestroPlaybookDetail;
  },

  /** Run a playbook and return the final completion event. Uses --wait so the CLI blocks until done. */
  async runPlaybook(playbookId: string): Promise<PlaybookEvent> {
    const raw = await run(['playbook', playbookId, '--wait']);
    // --wait streams JSONL events; the last line is the "complete" event
    const lines = raw.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    return JSON.parse(lastLine) as PlaybookEvent;
  },
};
