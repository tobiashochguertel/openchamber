import React from 'react';
import { z } from 'zod';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { getSafeStorage } from '@/stores/utils/safeStorage';

/** The dev-server settings dialog's corner-drag size, remembered per runtime. */
export type DevServerDialogSize = {
  readonly width: number;
  readonly height: number;
};

const STORAGE_KEY = 'oc.browser.devServerDialogSize.v1';

const sizeSchema = z.object({ width: z.number(), height: z.number() });
const storeSchema = z.record(z.string(), sizeSchema);
type StoredSizes = z.infer<typeof storeSchema>;

let cache: { raw: string | null; value: StoredSizes } | null = null;

const read = (): StoredSizes => {
  const raw = getSafeStorage().getItem(STORAGE_KEY);
  if (cache && cache.raw === raw) return cache.value;
  let value: StoredSizes = {};
  if (raw !== null) {
    try {
      const parsed = storeSchema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      value = {};
    }
  }
  cache = { raw, value };
  return value;
};

const write = (next: StoredSizes): void => {
  const storage = getSafeStorage();
  if (Object.keys(next).length === 0) {
    storage.removeItem(STORAGE_KEY);
  } else {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
};

const listeners = new Set<() => void>();
const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getDevServerDialogSize = (): DevServerDialogSize | null =>
  read()[getRuntimeKey()] ?? null;

export const setDevServerDialogSize = (size: DevServerDialogSize): void => {
  write({ ...read(), [getRuntimeKey()]: size });
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export const useDevServerDialogSize = (): DevServerDialogSize | null =>
  React.useSyncExternalStore(subscribe, getDevServerDialogSize, () => null);
