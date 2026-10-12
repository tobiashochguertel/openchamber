import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SortableTabsStrip, type SortableTabsStripItem } from '@/components/ui/sortable-tabs-strip';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import {
  isDevServerVisibleByRules,
  parseDevServerFilterRule,
  setDevServerFilterRules,
  useDevServerFilterRules,
} from '@/lib/browser/devServerFilters';
import { showHiddenDevServerPorts, unhideDevServerPort, useHiddenDevServerPorts } from '@/lib/browser/hiddenDevServers';
import { setDevServerLabel, useDevServerLabels } from '@/lib/browser/devServerLabels';
import { devServerContextLabel, type DevServerCandidate } from '@/lib/browser/devServers';
import {
  setDevServerDialogSize,
  useDevServerDialogSize,
  type DevServerDialogSize,
} from '@/lib/browser/devServerDialogSize';

type TabKey = 'filters' | 'hidden' | 'names';

const DIALOG_MIN_WIDTH = 620;
const DIALOG_MIN_HEIGHT = 400;

let measureCtx: CanvasRenderingContext2D | null | undefined;

const measureTextWidth = (text: string): number => {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = '11px ui-sans-serif, system-ui, sans-serif';
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 6.5;
};

/**
 * Size the dialog so the inspector column can show its longest
 * "field   value" line untruncated. Only used until the user resizes
 * by hand; the manual size is remembered instead.
 */
const estimateDialogSize = (servers: readonly DevServerCandidate[]): DevServerDialogSize => {
  let inspectorWidth = 300;
  for (const server of servers) {
    for (const { field, value } of inspectFields(server)) {
      inspectorWidth = Math.max(inspectorWidth, measureTextWidth(`${field}  ${value}`) + 56);
    }
  }
  const rows = Math.min(Math.max(servers.length, 6), 14);
  const width = Math.min(Math.max(320 + inspectorWidth, DIALOG_MIN_WIDTH), window.innerWidth - 48);
  const height = Math.min(Math.max(230 + rows * 28, DIALOG_MIN_HEIGHT), window.innerHeight - 48);
  return { width: Math.round(width), height: Math.round(height) };
};

type InspectField = { readonly field: string; readonly value: string };

/** Every field the filter language can read from one server. */
const inspectFields = (candidate: DevServerCandidate): InspectField[] => {
  const fields: InspectField[] = [
    { field: 'port', value: String(candidate.port) },
    { field: 'url', value: candidate.url },
  ];
  if (candidate.command) fields.push({ field: 'command', value: candidate.command });
  if (candidate.source) fields.push({ field: 'source', value: candidate.source });
  if (candidate.project) fields.push({ field: 'project', value: candidate.project });
  if (candidate.commandLine) fields.push({ field: 'commandLine', value: candidate.commandLine });
  if (candidate.cwd) fields.push({ field: 'cwd', value: candidate.cwd });
  try {
    fields.push({ field: 'host', value: new URL(candidate.url).hostname });
  } catch {
    // unreachable unless url failed to parse
  }
  if (candidate.announced) fields.push({ field: 'announced', value: 'true' });
  if (candidate.docker) {
    fields.push({ field: 'docker.name', value: candidate.docker.name });
    fields.push({ field: 'docker.image', value: candidate.docker.image });
    fields.push({ field: 'docker.id', value: candidate.docker.id });
    for (const [key, value] of Object.entries(candidate.docker.labels)) {
      fields.push({ field: `docker.label.${key}`, value });
    }
  }
  if (candidate.forward) {
    fields.push({ field: 'forward.host', value: candidate.forward.host });
    fields.push({ field: 'forward.port', value: String(candidate.forward.port) });
  }
  return fields;
};

/** field=value, quoting the value when it contains whitespace or a quote. */
const ruleTerm = (field: string, value: string): string => {
  const body = /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  return `${field}=${body}`;
};

const FiltersTab: React.FC<{ servers: readonly DevServerCandidate[] }> = ({ servers }) => {
  const { t } = useI18n();
  const rules = useDevServerFilterRules();
  const [draft, setDraft] = React.useState<string | null>(null);
  const [expandedPort, setExpandedPort] = React.useState<number | null>(null);
  const text = draft ?? rules.join('\n');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const invalid = lines.filter((line) => !parseDevServerFilterRule(line).ok).length;
  const visible = servers.filter((server) => isDevServerVisibleByRules(server, lines)).length;

  const update = (value: string) => {
    setDraft(value);
    setDevServerFilterRules(value.split('\n'));
  };

  const appendRule = (field: string, value: string) => {
    const term = ruleTerm(field, value);
    update(text.trim().length > 0 ? `${text.trimEnd()}\n${term}` : term);
  };

  return (
    <div className="flex gap-3">
      <div className="flex w-[46%] min-w-0 flex-col gap-2">
        <span className="typography-micro text-muted-foreground">
          {t('contextPanel.browser.devServers.settings.rulesLabel')}
        </span>
        <Textarea
          value={text}
          onChange={(event) => update(event.target.value)}
          placeholder={'docker\n!port<1024'}
          aria-label={t('contextPanel.browser.devServers.settings.rulesLabel')}
          spellCheck={false}
          className="min-h-[220px] font-mono typography-micro"
        />
        <div className="flex items-center justify-between typography-micro">
          <span className="text-muted-foreground">
            {t('contextPanel.browser.devServers.settings.matchCount', { visible, total: servers.length })}
          </span>
          {invalid > 0 && (
            <span className="text-destructive">
              {t('contextPanel.browser.devServers.settings.invalidCount', { count: invalid })}
            </span>
          )}
        </div>
        <p className="typography-micro text-muted-foreground whitespace-pre-wrap">
          {t('contextPanel.browser.devServers.settings.filtersHint')}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="typography-micro text-muted-foreground">
          {t('contextPanel.browser.devServers.settings.inspectLabel')}
        </span>
        {servers.length === 0 ? (
          <p className="typography-micro text-muted-foreground">
            {t('contextPanel.browser.devServers.settings.noServers')}
          </p>
        ) : (
          <ul className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto pe-0.5">
            {servers.map((server) => {
              const expanded = expandedPort === server.port;
              return (
                <li key={server.port}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-start hover:bg-muted/60"
                    onClick={() => setExpandedPort(expanded ? null : server.port)}
                    aria-expanded={expanded}
                    aria-label={t('contextPanel.browser.devServers.settings.expandServer', { port: server.port })}
                  >
                    <Icon
                      name="arrow-right-s"
                      className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
                      aria-hidden="true"
                    />
                    <span className="typography-micro text-foreground">{server.port}</span>
                    <span className="truncate typography-micro text-muted-foreground">
                      {devServerContextLabel(server)}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="mx-1 mb-1 flex flex-col gap-0.5 rounded-sm border border-border bg-muted/40 p-1.5">
                      {inspectFields(server).map(({ field, value }) => (
                        <div key={field} className="flex items-center gap-1.5 typography-micro">
                          <span className="shrink-0 text-muted-foreground">{field}</span>
                          <span className="truncate text-foreground" title={value}>{value}</span>
                          <button
                            type="button"
                            className="ms-auto flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => appendRule(field, value)}
                            aria-label={t('contextPanel.browser.devServers.settings.appendRule', { field })}
                            title={t('contextPanel.browser.devServers.settings.appendRule', { field })}
                          >
                            <Icon name="add" className="size-3" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

const HiddenTab: React.FC = () => {
  const { t } = useI18n();
  const hiddenPorts = useHiddenDevServerPorts();
  if (hiddenPorts.length === 0) {
    return <p className="typography-micro text-muted-foreground">{t('contextPanel.browser.devServers.settings.noHidden')}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="typography-micro text-muted-foreground">
          {t('contextPanel.browser.devServers.settings.hiddenCount', { count: hiddenPorts.length })}
        </span>
        <Button size="sm" variant="outline" onClick={() => showHiddenDevServerPorts()}>
          {t('contextPanel.browser.devServers.settings.showAll')}
        </Button>
      </div>
      <ul className="flex flex-col">
        {hiddenPorts.map((port) => (
          <li key={port} className="flex items-center gap-2 py-1">
            <span className="typography-ui-label text-foreground">localhost:{port}</span>
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto h-6 px-2"
              onClick={() => unhideDevServerPort(port)}
              aria-label={t('contextPanel.browser.devServers.settings.showPort', { port })}
            >
              {t('contextPanel.browser.devServers.settings.show')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const NamesTab: React.FC = () => {
  const { t } = useI18n();
  const labels = useDevServerLabels();
  const entries = Object.entries(labels).sort(([left], [right]) => Number(left) - Number(right));
  if (entries.length === 0) {
    return <p className="typography-micro text-muted-foreground">{t('contextPanel.browser.devServers.settings.noNames')}</p>;
  }
  return (
    <ul className="flex flex-col">
      {entries.map(([port, name]) => (
        <li key={port} className="flex items-center gap-2 py-1">
          <span className="typography-ui-label text-foreground truncate">{name}</span>
          <span className="typography-micro text-muted-foreground">:{port}</span>
          <Button
            size="icon"
            variant="ghost"
            className="ms-auto size-6"
            onClick={() => setDevServerLabel(Number(port), null)}
            aria-label={t('contextPanel.browser.devServers.settings.clearName', { port })}
          >
            <Icon name="delete-bin" className="size-3" />
          </Button>
        </li>
      ))}
    </ul>
  );
};

/**
 * Settings for the browser panel's dev-server list: filter rules beside a
 * live inspector, the hidden ports, and the names pinned to ports.
 */
export const DevServerSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: readonly DevServerCandidate[];
}> = ({ open, onOpenChange, servers }) => {
  const { t, direction } = useI18n();
  const [tab, setTab] = React.useState<TabKey>('filters');
  const storedSize = useDevServerDialogSize();
  const [dragSize, setDragSize] = React.useState<DevServerDialogSize | null>(null);
  const autoSize = React.useMemo(() => estimateDialogSize(servers), [servers]);
  const size = dragSize ?? storedSize ?? autoSize;
  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    last: DevServerDialogSize;
  } | null>(null);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = { width: size.width, height: size.height };
    dragRef.current = { startX: event.clientX, startY: event.clientY, startWidth: start.width, startHeight: start.height, last: start };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const sign = direction === 'rtl' ? -1 : 1;
    const onMove = (moveEvent: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const next = {
        width: Math.min(Math.max(state.startWidth + (moveEvent.clientX - state.startX) * sign, DIALOG_MIN_WIDTH), window.innerWidth - 48),
        height: Math.min(Math.max(state.startHeight + (moveEvent.clientY - state.startY), DIALOG_MIN_HEIGHT), window.innerHeight - 48),
      };
      state.last = next;
      setDragSize(next);
    };
    const onUp = () => {
      const state = dragRef.current;
      dragRef.current = null;
      setDragSize(null);
      if (state) setDevServerDialogSize(state.last);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
    event.preventDefault();
  };

  const tabs = React.useMemo<SortableTabsStripItem[]>(() => [
    { id: 'filters', label: t('contextPanel.browser.devServers.settings.filtersTab') },
    { id: 'hidden', label: t('contextPanel.browser.devServers.settings.hiddenTab') },
    { id: 'names', label: t('contextPanel.browser.devServers.settings.namesTab') },
  ], [t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none"
        style={{ width: size.width, height: size.height, maxWidth: '95vw', maxHeight: '90vh' }}
      >
        <DialogHeader>
          <DialogTitle>{t('contextPanel.browser.devServers.settings.title')}</DialogTitle>
        </DialogHeader>

        <SortableTabsStrip
          items={tabs}
          activeId={tab}
          onSelect={(id) => {
            // SAFETY: ids come from the items array above, which only holds TabKey values.
            setTab(id as TabKey);
          }}
          layoutMode="fit"
          variant="active-pill"
          className="h-7 flex-none"
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'filters' && <FiltersTab servers={servers} />}
          {tab === 'hidden' && <HiddenTab />}
          {tab === 'names' && <NamesTab />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.common.actions.close')}
          </Button>
        </DialogFooter>

        <div
          role="separator"
          aria-label={t('contextPanel.browser.devServers.settings.resize')}
          onPointerDown={startResize}
          className="absolute inset-e-2 bottom-2 z-10 flex size-7 cursor-nwse-resize items-end justify-end touch-none select-none rtl:cursor-nesw-resize"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
            className="rtl:-scale-x-100"
          >
            <path
              d="M9.11111 2L2 9.11111M10 6.44444L6.44444 10"
              className="stroke-muted-foreground"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
};
