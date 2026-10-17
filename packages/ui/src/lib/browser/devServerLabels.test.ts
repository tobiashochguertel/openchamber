import { describe, expect, test } from 'bun:test';

import { getDevServerLabel, setDevServerLabel } from './devServerLabels';

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
});
