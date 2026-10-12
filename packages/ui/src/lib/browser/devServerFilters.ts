/**
 * Per-runtime filter rules for the dev-server list.
 *
 * One rule per line in storage. A leading `!` makes the rule a hide rule.
 * Terms inside a rule are AND-ed; a server stays visible when no hide rule
 * matched and — as long as any keep rule exists — at least one keep rule did.
 *
 *   docker                      keep only ports a container published
 *   docker.name~excalidraw      container name contains
 *   docker.image=nginx:latest   image equals
 *   command!=ssh                owning process is not ssh
 *   forward.host~internal       ssh -L target host contains
 *   source=system               listener owned by an OS binary
 *   project=pake-gmail          working directory / compose project
 *   commandLine~serve.py        matches the full process argv
 *   !port<1024                  hide privileged ports
 *
 * Fields: port, command, url, host, announced, docker, docker.name,
 * docker.image, docker.id, docker.label.<key>, forward, forward.host,
 * forward.port, source, project, commandLine, cwd. A bare word matches
 * command, url, docker.name and project.
 */
import React from 'react';
import { z } from 'zod';

import { getRuntimeKey } from '@/lib/runtime-switch';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import type { DevServerDockerInfo, DevServerForwardInfo } from './devServers';

const STORAGE_KEY = 'oc.browser.devServerFilters.v1';
const storedSchema = z.record(z.string(), z.array(z.string()));
type StoredRules = z.infer<typeof storedSchema>;

const listeners = new Set<() => void>();
const EMPTY: readonly string[] = [];
let cache: { raw: string | null; value: StoredRules } | null = null;

const read = (): StoredRules => {
  const raw = getSafeStorage().getItem(STORAGE_KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value: StoredRules = {};
  if (raw !== null) {
    try {
      const parsed = storedSchema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      value = {};
    }
  }
  cache = { raw, value };
  return value;
};

const write = (next: StoredRules): void => {
  getSafeStorage().setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
};

export const getDevServerFilterRules = (runtimeKey = getRuntimeKey()): readonly string[] =>
  read()[runtimeKey] ?? EMPTY;

export const setDevServerFilterRules = (rules: readonly string[]): void => {
  const runtimeKey = getRuntimeKey();
  const cleaned = rules.map((rule) => rule.trim()).filter((rule) => rule.length > 0);
  const stored = read();
  if (cleaned.length === 0) {
    if (!stored[runtimeKey]) return;
    const next = { ...stored };
    delete next[runtimeKey];
    write(next);
    return;
  }
  write({ ...stored, [runtimeKey]: cleaned });
};

export const useDevServerFilterRules = (): readonly string[] =>
  React.useSyncExternalStore(
    React.useCallback((notify) => {
      listeners.add(notify);
      window.addEventListener('storage', notify);
      return () => {
        listeners.delete(notify);
        window.removeEventListener('storage', notify);
      };
    }, []),
    () => getDevServerFilterRules(),
    () => EMPTY,
  );

export type FilterableDevServer = {
  readonly port: number;
  readonly url: string;
  readonly command: string;
  readonly announced: boolean;
  readonly docker?: DevServerDockerInfo;
  readonly forward?: DevServerForwardInfo;
  readonly source?: string;
  readonly project?: string;
  readonly commandLine?: string;
  readonly cwd?: string;
};

export type FilterTerm = {
  readonly field: string;
  readonly op: 'exists' | '=' | '!=' | '~' | '!~' | '>' | '<';
  readonly value: string;
};

export type FilterRule =
  | { readonly ok: true; readonly negate: boolean; readonly terms: FilterTerm[] }
  | { readonly ok: false; readonly error: string };

/** Whitespace splits terms; single and double quotes group a value. */
const tokenize = (line: string): string[] | null => {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += char;
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
};

const TERM_PATTERN = /^([a-zA-Z][\w.]*)(!~|!=|=|~|>|<)?(.*)$/;
const FUZZY_FIELDS = ['command', 'url', 'docker.name', 'project', 'commandLine'] as const;

/** Field names that carry an op; anything else is a fuzzy bare-word term. */
const KNOWN_FIELD = /^(port|command|url|host|announced|source|project|commandLine|cwd|docker|docker\.name|docker\.image|docker\.id|docker\.label\.[\w.-]+|forward|forward\.host|forward\.port)$/;

export const parseDevServerFilterRule = (line: string): FilterRule => {
  const trimmed = line.trim();
  if (!trimmed) return { ok: false, error: 'empty' };
  const negate = trimmed.startsWith('!');
  const body = negate ? trimmed.slice(1).trim() : trimmed;
  if (!body) return { ok: false, error: 'empty' };
  const tokens = tokenize(body);
  if (!tokens || tokens.length === 0) return { ok: false, error: 'unbalanced-quote' };
  const terms: FilterTerm[] = [];
  for (const token of tokens) {
    const match = token.match(TERM_PATTERN);
    if (!match) return { ok: false, error: `term:${token}` };
    const [, field, op, value] = match;
    if (!KNOWN_FIELD.test(field)) {
      if (op || !field) return { ok: false, error: `field:${field}` };
      terms.push({ field: '*', op: '~', value: token });
      continue;
    }
    if (!value) {
      if (op && op !== '=') return { ok: false, error: `op:${op}` };
      terms.push({ field, op: 'exists', value: '' });
      continue;
    }
    // SAFETY: the op group of TERM_PATTERN only matches the listed operators.
    terms.push({ field, op: (op ?? '~') as FilterTerm['op'], value });
  }
  return { ok: true, negate, terms };
};

type ResolvedValue = { readonly exists: boolean; readonly value?: string | number };

const resolveField = (server: FilterableDevServer, field: string): ResolvedValue => {
  switch (field) {
    case 'port': return { exists: true, value: server.port };
    case 'command': return { exists: server.command.length > 0, value: server.command };
    case 'url': return { exists: true, value: server.url };
    case 'host': {
      try { return { exists: true, value: new URL(server.url).hostname }; }
      catch { return { exists: false }; }
    }
    case 'announced': return { exists: server.announced };
    case 'source': return { exists: server.source !== undefined, value: server.source };
    case 'project': return { exists: server.project !== undefined, value: server.project };
    case 'commandLine': return { exists: server.commandLine !== undefined, value: server.commandLine };
    case 'cwd': return { exists: server.cwd !== undefined, value: server.cwd };
    case 'docker': return { exists: server.docker !== undefined };
    case 'docker.name': return { exists: server.docker !== undefined, value: server.docker?.name };
    case 'docker.image': return { exists: server.docker !== undefined, value: server.docker?.image };
    case 'docker.id': return { exists: server.docker !== undefined, value: server.docker?.id };
    case 'forward': return { exists: server.forward !== undefined };
    case 'forward.host': return { exists: server.forward !== undefined, value: server.forward?.host };
    case 'forward.port': return { exists: server.forward !== undefined, value: server.forward?.port };
    default: {
      if (field.startsWith('docker.label.')) {
        const key = field.slice('docker.label.'.length);
        const label = server.docker?.labels[key];
        return { exists: label !== undefined, value: label };
      }
      return { exists: false };
    }
  }
};

const matchTerm = (server: FilterableDevServer, term: FilterTerm): boolean => {
  if (term.field === '*') {
    return FUZZY_FIELDS.some((field) => {
      const resolved = resolveField(server, field);
      return resolved.exists
        && String(resolved.value).toLowerCase().includes(term.value.toLowerCase());
    });
  }
  const resolved = resolveField(server, term.field);
  if (term.op === 'exists') return resolved.exists;
  if (!resolved.exists || resolved.value === undefined) return false;
  const left = String(resolved.value).toLowerCase();
  const right = term.value.toLowerCase();
  switch (term.op) {
    case '=': return left === right;
    case '!=': return left !== right;
    case '~': return left.includes(right);
    case '!~': return !left.includes(right);
    case '>': case '<': {
      const number = Number(resolved.value);
      const limit = Number(term.value);
      if (!Number.isFinite(number) || !Number.isFinite(limit)) return false;
      return term.op === '>' ? number > limit : number < limit;
    }
  }
};

export const serverMatchesFilterRule = (server: FilterableDevServer, rule: FilterRule): boolean => {
  if (!rule.ok || rule.terms.length === 0) return false;
  return rule.terms.every((term) => matchTerm(server, term));
};

/**
 * Applies the rule set to a server: any matched hide rule removes it; when
 * keep rules exist it must match at least one. Invalid rules are inert.
 */
export const isDevServerVisibleByRules = (server: FilterableDevServer, lines: readonly string[]): boolean => {
  const rules = lines.map(parseDevServerFilterRule).filter((rule) => rule.ok);
  if (rules.length === 0) return true;
  if (rules.some((rule) => rule.negate && serverMatchesFilterRule(server, rule))) return false;
  const keeps = rules.filter((rule) => !rule.negate);
  return keeps.length === 0 || keeps.some((rule) => serverMatchesFilterRule(server, rule));
};
