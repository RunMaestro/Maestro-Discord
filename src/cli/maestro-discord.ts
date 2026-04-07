#!/usr/bin/env node
import http from 'http';

function printUsage() {
  console.log(`Usage: maestro-discord --agent <id> --message <text> [--mention] [--port <number>]

Options:
  --agent    Maestro agent ID (required)
  --message  Message text to send (required)
  --mention  Mention users in the Discord channel
  --port     API port (default: 3457)
  --help     Show this help`);
}

let agentId = '';
let message = '';
let mention = false;
let port = 3457;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--agent':
      agentId = args[++i] || '';
      break;
    case '--message':
      message = args[++i] || '';
      break;
    case '--mention':
      mention = true;
      break;
    case '--port':
      port = parseInt(args[++i] || '3457', 10);
      break;
    case '--help':
      printUsage();
      process.exit(0);
      break;
    default:
      console.error(`Unknown flag: ${args[i]}`);
      process.exit(1);
  }
}

if (!agentId || !message) {
  console.error('Error: --agent and --message are required\n');
  printUsage();
  process.exit(1);
}

const payload = JSON.stringify({ agentId, message, mention });

const req = http.request(
  {
    hostname: '127.0.0.1',
    port,
    path: '/api/send',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      try {
        const result = JSON.parse(body);
        if (result.success) {
          console.log(JSON.stringify(result));
          process.exit(0);
        } else {
          console.error(JSON.stringify(result));
          process.exit(1);
        }
      } catch {
        console.error('Invalid response from bot');
        process.exit(1);
      }
    });
  },
);

req.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
    console.error('Error: Bot is not running or API server is not started');
  } else {
    console.error(`Error: ${err.message}`);
  }
  process.exit(1);
});

req.write(payload);
req.end();
