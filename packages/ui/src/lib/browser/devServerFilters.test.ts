import { describe, expect, test } from 'bun:test';

import {
  isDevServerVisibleByRules,
  parseDevServerFilterRule,
  setDevServerFilterRules,
  getDevServerFilterRules,
  type FilterableDevServer,
} from './devServerFilters';

const dockerServer = (overrides: Partial<FilterableDevServer> = {}): FilterableDevServer => ({
  port: 45583,
  url: 'http://localhost:45583/',
  command: 'ssh',
  announced: false,
  docker: {
    id: 'a1b2',
    name: 'hedgedoc',
    image: 'quay.io/hedgedoc/hedgedoc:1.10',
    labels: { 'com.docker.compose.service': 'hedgedoc' },
  },
  ...overrides,
});

describe('filter rule parsing', () => {
  test('parses ops, quotes and negation', () => {
    const rule = parseDevServerFilterRule('docker.name~hedgedoc port>1024');
    expect(rule.ok).toBe(true);
    if (!rule.ok) return;
    expect(rule.negate).toBe(false);
    expect(rule.terms).toHaveLength(2);

    const negated = parseDevServerFilterRule('!command=ssh');
    expect(negated.ok && negated.negate).toBe(true);

    const quoted = parseDevServerFilterRule('docker.label.com.docker.compose.project="my stack"');
    expect(quoted.ok).toBe(true);
    if (quoted.ok) expect(quoted.terms[0].value).toBe('my stack');

    const bare = parseDevServerFilterRule('docker');
    expect(bare.ok && bare.terms[0].op).toBe('exists');
  });

  test('rejects unknown fields with ops and unbalanced quotes', () => {
    expect(parseDevServerFilterRule('nonsense=1').ok).toBe(false);
    expect(parseDevServerFilterRule('docker.name~"unclosed').ok).toBe(false);
    expect(parseDevServerFilterRule('!').ok).toBe(false);
  });
});

describe('visibility by rules', () => {
  const hedgedoc = dockerServer();
  const node = { port: 3000, url: 'http://localhost:3000/', command: 'node', announced: true };

  test('no rules keeps everything', () => {
    expect(isDevServerVisibleByRules(hedgedoc, [])).toBe(true);
    expect(isDevServerVisibleByRules(node, [])).toBe(true);
  });

  test('keep rules must match at least one', () => {
    expect(isDevServerVisibleByRules(hedgedoc, ['docker'])).toBe(true);
    expect(isDevServerVisibleByRules(node, ['docker'])).toBe(false);
    expect(isDevServerVisibleByRules(node, ['docker', 'command=node'])).toBe(true);
  });

  test('hide rules remove matches before keep rules apply', () => {
    expect(isDevServerVisibleByRules(hedgedoc, ['!docker.name~hedge'])).toBe(false);
    expect(isDevServerVisibleByRules(hedgedoc, ['docker', '!docker.name~hedge'])).toBe(false);
    expect(isDevServerVisibleByRules(node, ['!port<1024'])).toBe(true);
  });

  test('docker fields, labels and forward targets resolve', () => {
    const forward = { ...node, command: 'ssh', forward: { host: 'app.internal', port: 80 } };
    expect(isDevServerVisibleByRules(hedgedoc, ['docker.image~hedgedoc:1.10'])).toBe(true);
    expect(isDevServerVisibleByRules(hedgedoc, ['docker.label.com.docker.compose.service=hedgedoc'])).toBe(true);
    expect(isDevServerVisibleByRules(forward, ['forward.host~internal'])).toBe(true);
    expect(isDevServerVisibleByRules(forward, ['forward'])).toBe(true);
    expect(isDevServerVisibleByRules(hedgedoc, ['forward'])).toBe(false);
  });

  test('bare words fuzzy-match command, url and docker.name', () => {
    expect(isDevServerVisibleByRules(hedgedoc, ['hedgedoc'])).toBe(true);
    expect(isDevServerVisibleByRules(node, ['hedgedoc'])).toBe(false);
    expect(isDevServerVisibleByRules(node, ['3000'])).toBe(true);
  });

  test('invalid rules are inert', () => {
    expect(isDevServerVisibleByRules(hedgedoc, ['docker.name~', 'docker'])).toBe(true);
  });
});

describe('rule storage', () => {
  test('round-trips rules per runtime and drops empty lines', () => {
    setDevServerFilterRules(['docker', ' ', '!command=ssh']);
    expect(getDevServerFilterRules()).toEqual(['docker', '!command=ssh']);
    setDevServerFilterRules([]);
    expect(getDevServerFilterRules()).toEqual([]);
  });
});
