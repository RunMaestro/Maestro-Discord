import test from 'node:test';
import assert from 'node:assert/strict';

test('config.required returns values and throws on missing keys', async () => {
  const previousEnv = { ...process.env };

  try {
    process.env.DISCORD_BOT_TOKEN = 'token-123';
    process.env.DISCORD_CLIENT_ID = 'client-456';
    process.env.DISCORD_GUILD_ID = 'guild-789';
    process.env.DISCORD_ALLOWED_USER_IDS = ' 111,222 ,, 333 ';

    const imported = (await import('../config')) as {
      default?: unknown;
      required?: (key: string) => string;
      config?: {
        token: string;
        clientId: string;
        guildId: string;
        allowedUserIds: string[];
      };
    };

    const configModule = (imported.default ?? imported) as {
      required: (key: string) => string;
      config: {
        token: string;
        clientId: string;
        guildId: string;
        allowedUserIds: string[];
      };
    };

    assert.equal(configModule.required('DISCORD_BOT_TOKEN'), 'token-123');
    assert.equal(configModule.config.token, 'token-123');
    assert.equal(configModule.config.clientId, 'client-456');
    assert.equal(configModule.config.guildId, 'guild-789');
    assert.deepEqual(configModule.config.allowedUserIds, ['111', '222', '333']);

    assert.throws(() => configModule.required('MISSING_ENV'), /Missing required env var/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value;
    }
  }
});
