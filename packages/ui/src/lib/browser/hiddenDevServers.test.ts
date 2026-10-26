import { describe, expect, test } from 'bun:test';

import {
  getHiddenDevServerPorts,
  hideDevServerPort,
  showHiddenDevServerPorts,
  unhideDevServerPort,
} from './hiddenDevServers';

describe('hidden dev server ports', () => {
  test('hides a port once, keeps them sorted, and shows them all again', () => {
    showHiddenDevServerPorts();
    hideDevServerPort(6463);
    hideDevServerPort(135);
    hideDevServerPort(6463);
    expect(getHiddenDevServerPorts()).toEqual([135, 6463]);

    showHiddenDevServerPorts();
    expect(getHiddenDevServerPorts()).toEqual([]);
  });

  test('unhides one port and keeps the rest hidden', () => {
    showHiddenDevServerPorts();
    hideDevServerPort(6463);
    hideDevServerPort(135);
    unhideDevServerPort(135);
    expect(getHiddenDevServerPorts()).toEqual([6463]);
    showHiddenDevServerPorts();
  });

  test('unhiding the last port clears the runtime entry', () => {
    showHiddenDevServerPorts();
    hideDevServerPort(8080);
    unhideDevServerPort(8080);
    expect(getHiddenDevServerPorts()).toEqual([]);
  });

  test('unhiding a port that is not hidden changes nothing', () => {
    showHiddenDevServerPorts();
    hideDevServerPort(3000);
    unhideDevServerPort(9999);
    expect(getHiddenDevServerPorts()).toEqual([3000]);
    showHiddenDevServerPorts();
  });
});
