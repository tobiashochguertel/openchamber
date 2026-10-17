import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { isIMECompositionEvent } from '@/lib/ime';

type DevServerLabelDialogProps = {
  /** The port being named; null keeps the dialog closed. */
  port: number | null;
  /** The current custom name, or '' when the row still shows its address. */
  currentLabel: string;
  /** Called with the new name, or null to remove the custom name. */
  onRename: (port: number, label: string | null) => void;
  onClose: () => void;
};

export const DevServerLabelDialog: React.FC<DevServerLabelDialogProps> = ({ port, currentLabel, onRename, onClose }) => {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');

  React.useEffect(() => {
    if (port !== null) setValue(currentLabel);
  }, [port, currentLabel]);

  const submit = () => {
    const label = value.trim();
    if (port !== null && label) onRename(port, label);
    onClose();
  };

  const reset = () => {
    if (port !== null) onRename(port, null);
    onClose();
  };

  return (
    <Dialog open={port !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('contextPanel.browser.devServers.nameDialog.title')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          placeholder={t('contextPanel.browser.devServers.nameDialog.placeholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !isIMECompositionEvent(event)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {port !== null ? (
          <p className="typography-micro text-muted-foreground">
            {t('contextPanel.browser.devServers.nameDialog.hint', { port })}
          </p>
        ) : null}
        <DialogFooter>
          {currentLabel ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              {t('contextPanel.browser.devServers.nameDialog.reset')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('dialog.common.actions.cancel')}
          </Button>
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            {t('contextPanel.browser.devServers.nameDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
