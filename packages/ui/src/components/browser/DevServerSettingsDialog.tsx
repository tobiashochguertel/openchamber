import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SortableTabsStrip, type SortableTabsStripItem } from '@/components/ui/sortable-tabs-strip';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import {
  isDevServerVisibleByRules,
  parseDevServerFilterRule,
  setDevServerFilterRules,
  useDevServerFilterRules,
} from '@/lib/browser/devServerFilters';
import { showHiddenDevServerPorts, unhideDevServerPort, useHiddenDevServerPorts } from '@/lib/browser/hiddenDevServers';
import { setDevServerLabel, useDevServerLabels } from '@/lib/browser/devServerLabels';
import type { DevServerCandidate } from '@/lib/browser/devServers';

type TabKey = 'filters' | 'hidden' | 'names';

const FiltersTab: React.FC<{ servers: readonly DevServerCandidate[] }> = ({ servers }) => {
  const { t } = useI18n();
  const rules = useDevServerFilterRules();
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? rules.join('\n');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const invalid = lines.filter((line) => !parseDevServerFilterRule(line).ok).length;
  const visible = servers.filter((server) => isDevServerVisibleByRules(server, lines)).length;

  const update = (value: string) => {
    setDraft(value);
    setDevServerFilterRules(value.split('\n'));
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(event) => update(event.target.value)}
        placeholder={'docker\n!port<1024'}
        aria-label={t('contextPanel.browser.devServers.settings.filtersTab')}
        spellCheck={false}
        className="min-h-[120px] font-mono typography-micro"
      />
      <p className="typography-micro text-muted-foreground whitespace-pre-wrap">
        {t('contextPanel.browser.devServers.settings.filtersHint')}
      </p>
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
 * Settings for the browser panel's dev-server list: filter rules, the hidden
 * ports, and the names pinned to ports.
 */
export const DevServerSettingsDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: readonly DevServerCandidate[];
}> = ({ open, onOpenChange, servers }) => {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<TabKey>('filters');

  const tabs = React.useMemo<SortableTabsStripItem[]>(() => [
    { id: 'filters', label: t('contextPanel.browser.devServers.settings.filtersTab') },
    { id: 'hidden', label: t('contextPanel.browser.devServers.settings.hiddenTab') },
    { id: 'names', label: t('contextPanel.browser.devServers.settings.namesTab') },
  ], [t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('contextPanel.browser.devServers.settings.title')}</DialogTitle>
        </DialogHeader>

        <SortableTabsStrip
          items={tabs}
          activeId={tab}
          // SAFETY: ids come from the items array above, which only holds TabKey values.
          onSelect={(id) => setTab(id as TabKey)}
          layoutMode="fit"
          variant="active-pill"
          className="h-7"
        />

        <div className="min-h-[160px]">
          {tab === 'filters' && <FiltersTab servers={servers} />}
          {tab === 'hidden' && <HiddenTab />}
          {tab === 'names' && <NamesTab />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('dialog.common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
