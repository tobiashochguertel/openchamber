import { describe, expect, test } from 'bun:test';

import {
  parseDockerPortEntry,
  parseDockerPorts,
  parseSshForwards,
  enrichServers,
} from './enrich.js';

describe('docker port parsing', () => {
  test('reads the host side of every published mapping', () => {
    expect(parseDockerPortEntry('127.0.0.1:34130->80/tcp')).toBe(34130);
    expect(parseDockerPortEntry('0.0.0.0:8080->80/tcp')).toBe(8080);
    expect(parseDockerPortEntry('[::]:8080->80/tcp')).toBe(8080);
    expect(parseDockerPortEntry('34130->80/tcp')).toBe(34130);
    expect(parseDockerPortEntry('127.0.0.1:8080-8090->8080-8090/tcp')).toBe(8080);
    expect(parseDockerPortEntry('')).toBeNull();
  });

  test('maps ports onto their container with name, image and labels', () => {
    const output = [
      'a1b2\thedgedoc\tquay.io/hedgedoc/hedgedoc:1.10\t127.0.0.1:45583->3000/tcp\tcom.docker.compose.project=services,com.docker.compose.service=hedgedoc',
      'c3d4\texcalidraw\texcalidraw/excalidraw:latest\t0.0.0.0:44186->80/tcp\t',
    ].join('\n');
    const ports = parseDockerPorts(output);
    const hedgedoc = ports.get(45583);
    expect(hedgedoc).toBeDefined();
    expect(hedgedoc.name).toBe('hedgedoc');
    expect(hedgedoc.image).toBe('quay.io/hedgedoc/hedgedoc:1.10');
    expect(hedgedoc.labels['com.docker.compose.service']).toBe('hedgedoc');
    expect(ports.get(44186)?.name).toBe('excalidraw');
    expect(ports.get(9999)).toBeUndefined();
  });
});

describe('ssh -L forward parsing', () => {
  test('maps local listen ports onto their targets', () => {
    const args = '/usr/bin/ssh -F /dev/null -M -S /tmp/ssh.sock -fnNT -L 8080:app.internal:80 -L 127.0.0.1:2222:vm:22 colima';
    const forwards = parseSshForwards(args);
    expect(forwards.get(8080)).toEqual({ host: 'app.internal', port: 80 });
    expect(forwards.get(2222)).toEqual({ host: 'vm', port: 22 });
  });

  test('handles joined -L flag and bracketed bind', () => {
    const args = 'ssh -L8081:internal:81 -L[::1]:9090:db.internal:5432 host';
    const forwards = parseSshForwards(args);
    expect(forwards.get(8081)).toEqual({ host: 'internal', port: 81 });
    expect(forwards.get(9090)).toEqual({ host: 'db.internal', port: 5432 });
  });

  test('ignores non-forward flags and malformed specs', () => {
    const args = 'ssh -R 9000:svc:9000 -L bogus user@host';
    expect(parseSshForwards(args).size).toBe(0);
  });
});

describe('enrichServers', () => {
  const runCommandFor = (responses) => async (command, args) => {
    if (command === 'docker') return responses.docker ?? null;
    if (command === 'ps') return responses.ps ?? null;
    if (command === 'lsof') return responses.lsof ?? null;
    return null;
  };

  test('attaches docker context to published ports and forward targets to ssh owners', async () => {
    const servers = [
      { port: 45583, pid: 2461, command: 'ssh', url: 'http://localhost:45583/' },
      { port: 8080, pid: 7777, command: 'ssh', url: 'http://localhost:8080/' },
      { port: 3000, pid: 42, command: 'node', url: 'http://localhost:3000/' },
    ];
    const runCommand = runCommandFor({
      docker: 'a1b2\thedgedoc\thedgedoc:1.10\t127.0.0.1:45583->3000/tcp\tcom.docker.compose.project=hedgedoc,com.docker.compose.service=hedgedoc\n',
      ps: ' 7777 ssh -L 8080:app.internal:80 target\n',
    });
    const enriched = await enrichServers(servers, { runCommand });
    expect(enriched[0].docker?.name).toBe('hedgedoc');
    expect(enriched[0].source).toBe('docker');
    expect(enriched[0].project).toBe('hedgedoc');
    expect(enriched[1].forward).toEqual({ host: 'app.internal', port: 80 });
    expect(enriched[1].source).toBe('forward');
    expect(enriched[2].docker).toBeUndefined();
    expect(enriched[2].forward).toBeUndefined();
    expect(enriched[2].source).toBe('process');
  });

  test('classifies a process as system when its binary lives under /System', async () => {
    const servers = [{ port: 5000, pid: 10, command: 'ControlCenter', url: 'http://localhost:5000/' }];
    const runCommand = runCommandFor({
      ps: ' 10 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\n',
    });
    const enriched = await enrichServers(servers, { runCommand });
    expect(enriched[0].source).toBe('system');
    expect(enriched[0].commandLine).toContain('ControlCenter');
    expect(enriched[0].project).toBeUndefined();
  });

  test('derives the project from the working directory', async () => {
    const servers = [{ port: 9123, pid: 20, command: 'Python', url: 'http://localhost:9123/' }];
    const runCommand = runCommandFor({
      ps: ' 20 /usr/bin/python3 /x/serve.py --https\n',
      lsof: 'p20\nn/home/u/work/dev/tools/pake-gmail\n',
    });
    const enriched = await enrichServers(servers, { runCommand });
    expect(enriched[0].source).toBe('process');
    expect(enriched[0].project).toBe('pake-gmail');
    expect(enriched[0].cwd).toBe('/home/u/work/dev/tools/pake-gmail');
  });

  test('leaves servers untouched when docker is unavailable', async () => {
    const servers = [{ port: 3000, pid: 1, command: 'node', url: 'http://localhost:3000/' }];
    const enriched = await enrichServers(servers, { runCommand: runCommandFor({}) });
    expect(enriched[0]).toEqual({ ...servers[0], source: 'process' });
  });
});
