import { parseArgs } from 'node:util';
import { DEFAULT_PORT, fail, ok, postToSendApi, runMaestroCli } from '../lib';

export const statusUsage = `Usage: maestro-discord status --agent <id> [--port <number>]

Fetch agent details from maestro-cli and post a formatted status summary to
the agent's Discord channel.

Options:
  -a, --agent <id>     Maestro agent ID (required)
      --mention        Mention the user set in DISCORD_MENTION_USER_ID
  -p, --port <number>  API port (default: ${DEFAULT_PORT})
  -h, --help           Show this help`;

interface AgentDetail {
  id?: string;
  name?: string;
  toolType?: string;
  cwd?: string;
  status?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalCostUsd?: number;
    contextUsagePercent?: number;
  };
  [key: string]: unknown;
}

function formatStatus(detail: AgentDetail): string {
  const lines: string[] = [];
  const name = detail.name ?? detail.id ?? 'unknown';
  lines.push(`📊 **Status: ${name}**`);
  if (detail.toolType) lines.push(`Tool: \`${detail.toolType}\``);
  if (detail.cwd) lines.push(`Cwd: \`${detail.cwd}\``);
  if (detail.status) lines.push(`State: ${detail.status}`);

  const u = detail.usage;
  if (u) {
    const parts: string[] = [];
    if (typeof u.contextUsagePercent === 'number') {
      parts.push(`context ${u.contextUsagePercent.toFixed(1)}%`);
    }
    if (typeof u.totalCostUsd === 'number') {
      parts.push(`$${u.totalCostUsd.toFixed(4)}`);
    }
    if (typeof u.inputTokens === 'number' && typeof u.outputTokens === 'number') {
      parts.push(`${u.inputTokens}↓ ${u.outputTokens}↑ tokens`);
    }
    if (parts.length) lines.push(`Usage: ${parts.join(' · ')}`);
  }

  return lines.join('\n');
}

export async function runStatus(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        agent: { type: 'string', short: 'a' },
        mention: { type: 'boolean', default: false },
        port: { type: 'string', short: 'p' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message);
  }

  if (parsed.values.help) {
    console.log(statusUsage);
    process.exit(0);
  }

  const agentId = parsed.values.agent;
  if (!agentId) {
    console.error(statusUsage);
    fail('--agent is required');
  }

  const port = parsed.values.port ? parseInt(parsed.values.port, 10) : DEFAULT_PORT;
  if (Number.isNaN(port)) fail('--port must be a number');

  let detail: AgentDetail;
  try {
    const raw = await runMaestroCli(['show', 'agent', agentId, '--json']);
    detail = JSON.parse(raw) as AgentDetail;
  } catch (err) {
    fail(`maestro-cli show agent failed: ${(err as Error).message}`);
  }

  try {
    const result = await postToSendApi(
      { agentId, message: formatStatus(detail), mention: parsed.values.mention },
      port,
    );
    ok(result);
  } catch (err) {
    fail((err as Error).message);
  }
}
