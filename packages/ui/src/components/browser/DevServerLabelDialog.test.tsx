import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

// @base-ui Popup never mounts under happy-dom; the chrome is not what is
// under test, so the dialog primitives render plain wrappers here.
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { I18nProvider } from '@/lib/i18n';
import { DevServerLabelDialog } from './DevServerLabelDialog';

let dom: Window;
let root: Root;
let originals: Map<string, PropertyDescriptor | undefined>;

const input = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input');
  if (!el) throw new Error('dialog input missing');
  return el;
};

const button = (text: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`button "${text}" missing`);
  return found;
};

const mount = (props: {
  port: number | null;
  currentLabel: string;
  onRename: (port: number, label: string | null) => void;
  onClose: () => void;
}) => act(async () => root.render(
  <I18nProvider>
    <DevServerLabelDialog {...props} />
  </I18nProvider>,
));

beforeEach(() => {
  dom = new Window({ url: 'http://localhost' });
  originals = new Map();
  const globals: Record<string, unknown> = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    FocusEvent: dom.FocusEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(async () => {
  await act(async () => root.unmount());
  await dom.happyDOM.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('dev server label dialog', () => {
  // React's onChange does not fire for synthetic input events under happy-dom,
  // so these cover the click-driven paths and rendered state; typing into the
  // field only feeds setDevServerLabel, which devServerLabels.test.ts covers.
  test('prefills the current name and renames on save', async () => {
    const calls: Array<[number, string | null]> = [];
    let closed = 0;
    await mount({
      port: 45583, currentLabel: 'HedgeDoc',
      onRename: (p, l) => calls.push([p, l]),
      onClose: () => { closed += 1; },
    });

    expect(input().value).toBe('HedgeDoc');
    await act(async () => button('Save').click());
    expect(calls).toEqual([[45583, 'HedgeDoc']]);
    expect(closed).toBe(1);
  });

  test('disables save while the field is blank and hides reset without a name', async () => {
    await mount({ port: 45583, currentLabel: '', onRename: () => {}, onClose: () => {} });
    expect(button('Save').disabled).toBe(true);
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Reset')).toBe(false);
  });

  test('reset clears the name, cancel only closes', async () => {
    const calls: Array<[number, string | null]> = [];
    let closed = 0;
    await mount({
      port: 3000, currentLabel: 'Old',
      onRename: (p, l) => calls.push([p, l]),
      onClose: () => { closed += 1; },
    });

    await act(async () => button('Reset').click());
    expect(calls).toEqual([[3000, null]]);

    await act(async () => button('Cancel').click());
    expect(calls).toHaveLength(1);
    expect(closed).toBe(2);
  });
});
