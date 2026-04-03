import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { maestro, resetAgentCwdCache, AGENT_CWD_CACHE_TTL } from '../services/maestro';
import type { MaestroAgent } from '../services/maestro';

const fakeAgents: MaestroAgent[] = [
  { id: 'agent-1', name: 'Agent One', toolType: 'claude', cwd: '/home/user/project-a' },
  { id: 'agent-2', name: 'Agent Two', toolType: 'claude', cwd: '/home/user/project-b' },
];

afterEach(() => {
  mock.restoreAll();
  resetAgentCwdCache();
});

test('getAgentCwd returns the correct cwd for a known agent', async () => {
  mock.method(maestro, 'listAgents', async () => fakeAgents);

  const cwd = await maestro.getAgentCwd('agent-1');
  assert.equal(cwd, '/home/user/project-a');
});

test('getAgentCwd returns null for an unknown agent', async () => {
  mock.method(maestro, 'listAgents', async () => fakeAgents);

  const cwd = await maestro.getAgentCwd('nonexistent');
  assert.equal(cwd, null);
});

test('getAgentCwd caches results and does not re-invoke listAgents within TTL', async () => {
  const listAgentsMock = mock.method(maestro, 'listAgents', async () => fakeAgents);

  await maestro.getAgentCwd('agent-1');
  await maestro.getAgentCwd('agent-2');
  await maestro.getAgentCwd('agent-1');

  assert.equal(listAgentsMock.mock.callCount(), 1);
});

test('getAgentCwd refreshes cache after TTL expires', async () => {
  const listAgentsMock = mock.method(maestro, 'listAgents', async () => fakeAgents);

  await maestro.getAgentCwd('agent-1');
  assert.equal(listAgentsMock.mock.callCount(), 1);

  // Simulate TTL expiry by resetting cache
  resetAgentCwdCache();

  await maestro.getAgentCwd('agent-2');
  assert.equal(listAgentsMock.mock.callCount(), 2);
});
