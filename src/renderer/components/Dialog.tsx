import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { IconAlert, IconInfo } from './icons';

export interface DialogButton {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost' | 'default';
  /** Returned value when this button is pressed. */
  value: string;
}

export interface DialogOptions {
  title: string;
  message?: string | React.ReactNode;
  tone?: 'info' | 'warn' | 'danger';
  buttons: DialogButton[];
  /** Default button index (returned on Enter). */
  defaultIndex?: number;
  /** Returned when dialog is dismissed (Esc / backdrop click). */
  cancelValue?: string;
}

interface DialogContextValue {
  show: (opts: DialogOptions) => Promise<string>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export const useDialog = () => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside DialogProvider');
  return ctx;
};

type Resolver = (value: string) => void;

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [opts, setOpts] = useState<DialogOptions | null>(null);
  const [resolver, setResolver] = useState<Resolver | null>(null);

  const show = useCallback((next: DialogOptions): Promise<string> => {
    return new Promise<string>((resolve) => {
      setOpts(next);
      setResolver(() => resolve);
    });
  }, []);

  const close = (value: string) => {
    if (resolver) resolver(value);
    setOpts(null);
    setResolver(null);
  };

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(opts.cancelValue ?? 'cancel');
      if (e.key === 'Enter' && opts.defaultIndex !== undefined) {
        const btn = opts.buttons[opts.defaultIndex];
        if (btn) close(btn.value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts]);

  return (
    <DialogContext.Provider value={{ show }}>
      {children}
      {opts && (
        <div className="dialog-backdrop" onClick={() => close(opts.cancelValue ?? 'cancel')}>
          <div className={'dialog ' + (opts.tone || 'info')} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-icon">
              {opts.tone === 'danger' || opts.tone === 'warn' ? <IconAlert /> : <IconInfo />}
            </div>
            <div className="dialog-body">
              <h3 className="dialog-title">{opts.title}</h3>
              {opts.message && <div className="dialog-msg">{opts.message}</div>}
              <div className="dialog-actions">
                {opts.buttons.map((b, i) => (
                  <button
                    key={i}
                    autoFocus={opts.defaultIndex === i}
                    className={'btn ' + (b.variant || 'default')}
                    onClick={() => close(b.value)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
};
