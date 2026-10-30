import { describe, expect, test } from 'bun:test';

import { getRuntimeKey } from '../runtime-switch';
import { getSafeStorage } from '../../stores/utils/safeStorage';
import { getDevServerLabel, setDevServerLabel } from './devServerLabels';

const STORAGE_KEY = 'oc.browser.devServerLabels.v1';

describe('dev server labels', () => {
  test('names a port, keeps the name per port, and resets it', () => {
    setDevServerLabel(45583, 'HedgeDoc');
    setDevServerLabel(35561, 'Homarr');
    expect(getDevServerLabel(45583)).toBe('HedgeDoc');
    expect(getDevServerLabel(35561)).toBe('Homarr');
    expect(getDevServerLabel(3000)).toBeUndefined();

    setDevServerLabel(45583, 'Docs');
    expect(getDevServerLabel(45583)).toBe('Docs');

    setDevServerLabel(45583, null);
    setDevServerLabel(35561, null);
    expect(getDevServerLabel(45583)).toBeUndefined();
    expect(getDevServerLabel(35561)).toBeUndefined();
  });

  test('scopes names to the runtime they were set on', () => {
    setDevServerLabel(45583, 'HedgeDoc');
    expect(getDevServerLabel(45583, 'another-runtime')).toBeUndefined();
    setDevServerLabel(45583, null);
  });

  test('stores names under the runtime key', () => {
    setDevServerLabel(45583, 'HedgeDoc');
    const stored = JSON.parse(getSafeStorage().getItem(STORAGE_KEY) ?? '{}');
    expect(stored[getRuntimeKey()]).toEqual({ '45583': 'HedgeDoc' });
    setDevServerLabel(45583, null);
  });

  test('dropping the last name removes the runtime entry', () => {
    setDevServerLabel(45583, 'HedgeDoc');
    setDevServerLabel(45583, null);
    const stored = JSON.parse(getSafeStorage().getItem(STORAGE_KEY) ?? '{}');
    expect(stored[getRuntimeKey()]).toBeUndefined();
  });
});
