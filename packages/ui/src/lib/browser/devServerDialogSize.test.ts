import { describe, expect, test } from 'bun:test';

import { getRuntimeKey } from '../runtime-switch';
import { getSafeStorage } from '../../stores/utils/safeStorage';
import { getDevServerDialogSize, setDevServerDialogSize } from './devServerDialogSize';

const STORAGE_KEY = 'oc.browser.devServerDialogSize.v1';

describe('dev server dialog size', () => {
  test('starts unset and round-trips a size under the runtime key', () => {
    getSafeStorage().removeItem(STORAGE_KEY);
    expect(getDevServerDialogSize()).toBeNull();

    setDevServerDialogSize({ width: 900, height: 620 });
    expect(getDevServerDialogSize()).toEqual({ width: 900, height: 620 });

    const stored = JSON.parse(getSafeStorage().getItem(STORAGE_KEY) ?? '{}');
    expect(stored[getRuntimeKey()]).toEqual({ width: 900, height: 620 });
  });

  test('malformed stored data falls back to unset', () => {
    getSafeStorage().setItem(STORAGE_KEY, '{corrupt');
    expect(getDevServerDialogSize()).toBeNull();
    getSafeStorage().removeItem(STORAGE_KEY);
  });

  test('data that parses but fails the schema falls back to unset', () => {
    getSafeStorage().setItem(STORAGE_KEY, JSON.stringify({ [getRuntimeKey()]: 'small' }));
    expect(getDevServerDialogSize()).toBeNull();
    getSafeStorage().removeItem(STORAGE_KEY);
  });
});
