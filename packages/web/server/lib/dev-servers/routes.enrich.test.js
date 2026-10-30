import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import { createDevServerScanner } from './routes.js';

/**
 * runCommand() spawns with stdio ['ignore', 'pipe', 'ignore'], listens on
 * stdout data, error and close, and resolves the output on code 0. The stub
 * answers per command name, mirroring what docker/ps/lsof emit.
 */
const fakeSpawn = (outputs) => {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    const output = outputs(command, args);
    setImmediate(() => {
      if (output !== null) child.stdout.emit('data', output);
      child.emit('close', output === null ? 1 : 0);
    });
    return child;
  };
  return { spawn, calls };
};

const LISTENERS = [
  'p10', 'ccom.docker.', 'n*:45583',
  'p20', 'cssh', 'n*:8080',
  'p30', 'cnode', 'n*:3000',
].join('\n');

const respond = ({ lsof = LISTENERS, docker = null, ps = null, cwd = null }) => (command, args) => {
  if (command === 'lsof' && args.includes('-iTCP')) return lsof;
  if (command === 'lsof' && args.includes('cwd')) return cwd;
  if (command === 'docker') return docker;
  if (command === 'ps') return ps;
  return null;
};

describe('dev server scanner', () => {
  test('enriches discovery results with docker and forward context', async () => {
    const { spawn } = fakeSpawn(respond({
      docker: 'a1b2\thedgedoc\thedgedoc:1.10\t127.0.0.1:45583->3000/tcp\tcom.docker.compose.project=services\n',
      ps: ' 20 ssh -L 8080:app.internal:80 target\n',
    }));
    const scanner = createDevServerScanner({ spawn, platform: 'darwin' });
    const result = await scanner.discover();

    expect(result.ok).toBe(true);
    const byPort = new Map(result.servers.map((server) => [server.port, server]));
    expect(byPort.get(45583)?.docker?.name).toBe('hedgedoc');
    expect(byPort.get(45583)?.source).toBe('docker');
    expect(byPort.get(8080)?.forward).toEqual({ host: 'app.internal', port: 80 });
    expect(byPort.get(8080)?.source).toBe('forward');
    expect(byPort.get(3000)?.url).toBe('http://localhost:3000/');
  });

  test('drops the service\'s own ports from the offer', async () => {
    const { spawn } = fakeSpawn(respond({}));
    const scanner = createDevServerScanner({ spawn, platform: 'darwin' });
    const result = await scanner.discover({ ownPorts: [45583] });

    expect(result.ok).toBe(true);
    expect(result.servers.map((server) => server.port)).toEqual([3000, 8080]);
  });

  test('serves repeat looks from the cache without spawning again', async () => {
    const { spawn, calls } = fakeSpawn(respond({}));
    const scanner = createDevServerScanner({ spawn, platform: 'darwin' });

    await scanner.discover();
    const callsAfterFirst = calls.length;
    const second = await scanner.discover();

    expect(second.ok).toBe(true);
    expect(calls.length).toBe(callsAfterFirst);
  });

  test('reports failure when no listener source answers, and retries next time', async () => {
    const { spawn, calls } = fakeSpawn(respond({ lsof: null }));
    const readFile = () => Promise.reject(new Error('no proc'));
    const scanner = createDevServerScanner({ spawn, platform: 'linux', readFile });

    const first = await scanner.discover();
    expect(first.ok).toBe(false);
    expect(first.reason).toBe('no-listener-source');

    await scanner.discover();
    expect(calls.filter((call) => call[0] === 'lsof').length).toBe(2);
  });
});
