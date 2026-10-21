import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

// @base-ui Popup never mounts under happy-dom; the chrome is not what is
// under test, so the dialog primitives and the dnd-kit tab strip render
// plain wrappers here.
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

mock.module('@/components/ui/sortable-tabs-strip', () => ({
  SortableTabsStrip: ({ items, onSelect }: { items: Array<{ id: string; label: string }>; onSelect: (id: string) => void }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-sortable-tab-id={item.id} onClick={() => onSelect(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

import { I18nProvider } from '@/lib/i18n';
import { getDevServerFilterRules, setDevServerFilterRules } from '@/lib/browser/devServerFilters';
import { getDevServerLabel, setDevServerLabel } from '@/lib/browser/devServerLabels';
import { getHiddenDevServerPorts, hideDevServerPort, showHiddenDevServerPorts } from '@/lib/browser/hiddenDevServers';
import type { DevServerCandidate } from '@/lib/browser/devServers';
import { DevServerSettingsDialog } from './DevServerSettingsDialog';

let dom: Window;
let root: Root;
let originals: Map<string, PropertyDescriptor | undefined>;

const SERVERS: DevServerCandidate[] = [
  {
    port: 45583, url: 'http://localhost:45583/', command: 'node', announced: false,
    docker: { id: 'a1', name: 'hedgedoc', image: 'hedgedoc:1.10', labels: {} }, source: 'docker', project: 'services',
  },
  { port: 8080, url: 'http://localhost:8080/', command: 'ssh', announced: false, forward: { host: 'app.internal', port: 80 }, source: 'forward' },
  { port: 3000, url: 'http://localhost:3000/', command: 'node', announced: true },
];

const open = async () => act(async () => root.render(
  <I18nProvider>
    <DevServerSettingsDialog open onOpenChange={() => {}} servers={SERVERS} />
  </I18nProvider>,
));

const tab = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-sortable-tab-id="${id}"]`);
  if (!el) throw new Error(`tab ${id} missing`);
  return el;
};

const buttonByAria = (label: string): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`button "${label}" missing`);
  return el;
};

beforeEach(() => {
  dom = new Window({ url: 'http://localhost' });
  originals = new Map();
  const globals: Record<string, unknown> = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of ['window','document','navigator','localStorage','Element','HTMLElement','Node','Event','MouseEvent','KeyboardEvent','FocusEvent','PointerEvent','MutationObserver','ResizeObserver','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name in globals ? globals[name] : (dom as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  setDevServerFilterRules([]);
  showHiddenDevServerPorts();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(async () => {
  setDevServerFilterRules([]);
  showHiddenDevServerPorts();
  await act(async () => root.unmount());
  await dom.happyDOM.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('dev server settings dialog', () => {
  // React's onChange does not fire for synthetic input events under happy-dom,
  // so these cover the click-driven paths and rendered state; the rules and
  // names modules underneath have their own lib tests.
  test('filters tab shows every server when no rules hide any', async () => {
    await open();
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(document.body.textContent).toContain('3 of 3 shown');
    expect(document.body.textContent).toContain('45583');
    expect(document.body.textContent).toContain('hedgedoc');
    expect(document.body.textContent).toContain('app.internal:80');
  });

  test('hidden-by-rules servers move out of the shown count', async () => {
    setDevServerFilterRules(['docker']);
    await open();
    expect(document.body.textContent).toContain('1 of 3 shown');
  });

  test('the inspector appends a term for the expanded server field', async () => {
    await open();
    await act(async () => buttonByAria('Show fields for port 45583').click());
    await act(async () => buttonByAria('Add docker.name to the rules').click());
    expect(getDevServerFilterRules()).toEqual(['docker.name=hedgedoc']);
  });

  test('hidden tab lists manual hides, rule hides, and restores ports', async () => {
    hideDevServerPort(8080);
    setDevServerFilterRules(['docker']);
    await open();
    await act(async () => tab('hidden').click());

    expect(document.body.textContent).toContain('localhost:8080');
    expect(document.body.textContent).toContain('Hidden by rules');
    expect(document.body.textContent).toContain('matches no keep rule');

    await act(async () => buttonByAria('Show port 8080').click());
    expect(getHiddenDevServerPorts()).toEqual([]);
  });

  test('names tab lists editable inputs and removes stale entries', async () => {
    setDevServerLabel(9999, 'Stale');
    await open();
    await act(async () => tab('names').click());

    expect(document.querySelector('[aria-label="Name port 45583"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Stale');
    await act(async () => buttonByAria('Remove name from port 9999').click());
    expect(getDevServerLabel(9999)).toBeUndefined();
  });
});
