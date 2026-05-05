import { parseArgs } from 'node:util';
import { DEFAULT_PORT, fail, ok, parsePort, postToSendApi } from '../lib';

export const notifyUsage = `Usage: maestro-bridge notify <toast|flash> [options]

Post a styled notification message to an agent's bridge channel. Color maps
to a leading emoji so the alert stands out from regular messages.

Subcommands:
  toast   --agent <id> --title <t> --message <m> [--color <c>]
  flash   --agent <id> --message <m> [--detail <d>] [--color <c>]

Options:
  -a, --agent <id>      Maestro agent ID (required)
  -t, --title <text>    Title line (toast only, required)
  -m, --message <text>  Body text (required)
  -D, --detail <text>   Second line (flash only, optional)
  -c, --color <color>   green | yellow | orange | red | theme (default: theme)
      --mention         Mention the user set in DISCORD_MENTION_USER_ID
  -p, --port <number>   API port (default: ${DEFAULT_PORT})
  -h, --help            Show this help`;

const COLOR_EMOJI: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  orange: '🟠',
  red: '🔴',
  theme: '🔔',
};

function emojiFor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const e = COLOR_EMOJI[color];
  if (!e) fail(`--color must be one of: ${Object.keys(COLOR_EMOJI).join(', ')}`);
  return color === 'theme' ? fallback : e;
}

export async function runNotify(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(notifyUsage);
    process.exit(sub ? 0 : 1);
  }

  if (sub !== 'toast' && sub !== 'flash') {
    fail(`Unknown notify subcommand: ${sub}. Expected 'toast' or 'flash'.`);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        agent: { type: 'string', short: 'a' },
        title: { type: 'string', short: 't' },
        message: { type: 'string', short: 'm' },
        detail: { type: 'string', short: 'D' },
        color: { type: 'string', short: 'c' },
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
    console.log(notifyUsage);
    process.exit(0);
  }

  const agentId = parsed.values.agent;
  if (!agentId) fail('--agent is required');

  let port: number;
  try {
    port = parsePort(parsed.values.port);
  } catch (err) {
    fail((err as Error).message);
  }

  let content: string;
  if (sub === 'toast') {
    if (!parsed.values.title) fail('toast requires --title');
    if (!parsed.values.message) fail('toast requires --message');
    const icon = emojiFor(parsed.values.color, '🔔');
    content = `${icon} **${parsed.values.title}**\n${parsed.values.message}`;
  } else {
    if (!parsed.values.message) fail('flash requires --message');
    const icon = emojiFor(parsed.values.color, '⚡');
    content = `${icon} ${parsed.values.message}`;
    if (parsed.values.detail) content += `\n${parsed.values.detail}`;
  }

  try {
    const result = await postToSendApi(
      { agentId, message: content, mention: parsed.values.mention },
      port,
    );
    ok(result);
  } catch (err) {
    fail((err as Error).message);
  }
}
