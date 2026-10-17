import React from 'react';
import { z } from 'zod';

import { getRuntimeKey } from '@/lib/runtime-switch';
import { getSafeStorage } from '@/stores/utils/safeStorage';

/**
 * Names the user gave to listening ports in the browser panel's list of
 * running servers.
 *
 * Discovery reports a port and a process command, and neither tells the user
 * what the thing behind the port is. A name set once turns `localhost:34130`
 * into something recognisable whenever it listens again. Kept per runtime,
 * since each machine runs its own services.
 */
const STORAGE_KEY = 'oc.browser.devServerLabels.v1';
const storedSchema = z.record(z.string(), z.record(z.string(), z.string()));
type StoredLabels = z.infer<typeof storedSchema>;

const listeners = new Set<() => void>();
const EMPTY: Readonly<Record<string, string>> = {};
let cache: { raw: string | null; value: StoredLabels } | null = null;

const read = (): StoredLabels => {
  const raw = getSafeStorage().getItem(STORAGE_KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value: StoredLabels = {};
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

const write = (next: StoredLabels): void => {
  getSafeStorage().setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
};

const labelsFor = (runtimeKey: string): Readonly<Record<string, string>> => (
  read()[runtimeKey] ?? EMPTY
);

/** The name the user gave this port, or undefined when they never did. */
export const getDevServerLabel = (port: number, runtimeKey = getRuntimeKey()): string | undefined => (
  labelsFor(runtimeKey)[String(port)]
);

/** Stores a name for the port; null removes it and the row falls back to its address. */
export const setDevServerLabel = (port: number, label: string | null): void => {
  const runtimeKey = getRuntimeKey();
  const stored = read();
  const current = { ...(stored[runtimeKey] ?? {}) };
  if (label === null) {
    delete current[String(port)];
  } else {
    current[String(port)] = label;
  }
  const next = { ...stored };
  if (Object.keys(current).length === 0) {
    delete next[runtimeKey];
  } else {
    next[runtimeKey] = current;
  }
  write(next);
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The port -> name map for the active runtime. */
export const useDevServerLabels = (): Readonly<Record<string, string>> => (
  React.useSyncExternalStore(subscribe, () => labelsFor(getRuntimeKey()), () => EMPTY)
);
