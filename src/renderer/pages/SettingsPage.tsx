import React, { useEffect, useState } from 'react';
import type { LauncherSettings } from '../../shared/types';
import type { JavaInstallInfo, UpdaterState } from '../../preload/preload';
import { IconRefresh, IconFolder, IconCheck, IconAlert, IconTrash } from '../components/icons';
import { useDialog } from '../components/Dialog';

interface Props {
  settings: LauncherSettings;
  onChange: (s: LauncherSettings) => void;
}

export const SettingsPage: React.FC<Props> = ({ settings, onChange }) => {
  const dlg = useDialog();
  const [local, setLocal] = useState<LauncherSettings>(settings);
  const [javaList, setJavaList] = useState<JavaInstallInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [updater, setUpdater] = useState<UpdaterState | null>(null);

  useEffect(() => {
    window.api.java.list().then(setJavaList);
    window.api.updater.state().then(setUpdater);
    return window.api.updater.onState(setUpdater);
  }, []);

  const apply = (next: Partial<LauncherSettings>) => {
    const merged: LauncherSettings = { ...local, ...next };
    if (merged.javaPath === '' || merged.javaPath === undefined) {
      delete (merged as any).javaPath;
    }
    setLocal(merged);
    onChange(merged);
  };

  const pickDir = async () => {
    const dir = await window.api.settings.pickDir();
    if (dir) apply({ gameDir: dir });
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const list = await window.api.java.scan();
      setJavaList(list);
    } finally {
      setScanning(false);
    }
  };

  const gb = (local.memoryMb / 1024).toFixed(1);

  const updateLabel = (s: UpdaterState): string => {
    switch (s.status) {
      case 'checking': return 'Проверка...';
      case 'available': return `Доступна версия ${s.latest}`;
      case 'downloading': return `Загрузка... ${s.percent ?? 0}%`;
      case 'downloaded': return `Готово к установке: v${s.latest}`;
      case 'up-to-date': return 'Установлена последняя версия';
      case 'error': return 'Ошибка: ' + (s.error ?? 'неизвестно');
      case 'disabled': return 'Автообновление отключено (dev-режим)';
      default: return '—';
    }
  };

  const onResetLauncher = async () => {
    // Step 1: choice between cleanup options
    const step1 = await dlg.show({
      title: 'Сбросить лаунчер?',
      tone: 'danger',
      message: (
        <>
          Будут удалены: скачанные версии Minecraft, библиотеки, ассеты, кеш Java.
          <br />
          Можно дополнительно удалить личные данные (миры, аккаунты, настройки).
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Сохранить мои данные', value: 'keep', variant: 'default' },
        { label: 'Удалить всё полностью', value: 'wipe', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (step1 === 'cancel') return;

    // Step 2: final confirmation
    const step2 = await dlg.show({
      title: step1 === 'wipe' ? 'Точно удалить ВСЁ?' : 'Подтвердить сброс',
      tone: 'danger',
      message: step1 === 'wipe' ? (
        <>
          Это действие <b>необратимо</b>. Будут удалены все версии, миры, аккаунты, настройки.
          <br />
          Лаунчер перезапустится в начальном состоянии.
        </>
      ) : (
        <>
          Будут удалены кеш и скачанные версии. Личные данные (миры, аккаунты, настройки) <b>останутся</b>.
          <br />
          Лаунчер перезапустится.
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: step1 === 'wipe' ? 'Удалить всё и перезапустить' : 'Сбросить и перезапустить',
          value: 'go', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (step2 !== 'go') return;

    await window.api.reset.perform({ keepUserData: step1 === 'keep' });
    // лаунчер перезапустится сам через resetSvc.restart()
  };

  const onUninstallLauncher = async () => {
    const step1 = await dlg.show({
      title: 'Удалить лаунчер с компьютера?',
      tone: 'danger',
      message: (
        <>
          Лаунчер будет полностью удалён через стандартный установщик Windows.
          <br />
          Можно сохранить личные данные (миры, аккаунты, настройки) или стереть всё подчистую.
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Сохранить мои данные', value: 'keep', variant: 'default' },
        { label: 'Удалить всё полностью', value: 'wipe', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (step1 === 'cancel') return;

    const step2 = await dlg.show({
      title: 'Подтвердить удаление',
      tone: 'danger',
      message: step1 === 'wipe'
        ? 'Лаунчер и все данные будут удалены. Это действие необратимо.'
        : 'Лаунчер будет удалён, личные данные останутся в %APPDATA%\\Trel.',
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Удалить лаунчер', value: 'go', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (step2 !== 'go') return;

    const result = await window.api.reset.uninstallLauncher(step1 === 'keep');
    if (!result.ok) {
      await dlg.show({
        title: 'Не удалось запустить uninstaller',
        tone: 'warn',
        message: result.reason || 'Удалите лаунчер вручную через «Параметры → Приложения».',
        buttons: [{ label: 'Понятно', value: 'ok', variant: 'default' }],
        defaultIndex: 0,
        cancelValue: 'ok',
      });
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Настройки</h1>
        <p>Память, Java и расположение данных</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Обновление лаунчера</h2>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip mono">v{updater?.current ?? '—'}</span>
            <button
              className="btn ghost sm"
              onClick={() => window.api.updater.check()}
              disabled={updater?.status === 'checking' || updater?.status === 'downloading'}
            >
              <IconRefresh /> Проверить
            </button>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            {updater ? updateLabel(updater) : '—'}
          </div>
          {updater?.status === 'downloaded' && (
            <button className="btn primary sm" onClick={() => window.api.updater.install()}>
              Установить и перезапустить
            </button>
          )}
        </div>
        {updater?.status === 'downloading' && (
          <div className="progress" style={{ marginTop: 10 }}>
            <div className="progress-bar"><div className="fill" style={{ width: (updater.percent ?? 0) + '%' }} /></div>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          Обновления загружаются в фоне. Список версий Minecraft обновляется автоматически каждые 30 минут.
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Память JVM</h2>
          <span className="chip mono">{gb} ГБ</span>
        </div>
        <input
          type="range"
          min={1024}
          max={16384}
          step={256}
          value={local.memoryMb}
          onChange={(e) => apply({ memoryMb: parseInt(e.target.value) })}
        />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-subtle)' }}>
          <span>1 ГБ</span><span>16 ГБ</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Папка игры</h2>
          <button className="btn ghost sm" onClick={() => window.api.minecraft.openFolder('game')}>
            <IconFolder /> Открыть
          </button>
        </div>
        <div className="row">
          <input className="input mono" value={local.gameDir} readOnly />
          <button className="btn" onClick={pickDir}>Выбрать</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Java</h2>
          <button className="btn ghost sm" onClick={rescan} disabled={scanning}>
            <IconRefresh /> {scanning ? 'Поиск...' : 'Обновить'}
          </button>
        </div>

        <div className="field">
          <label>Обнаруженные среды</label>
          {javaList.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              Java не найдена. Подходящая JRE скачается автоматически при первом запуске.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 260, overflow: 'auto' }}>
              {javaList.map((j) => {
                const active = local.javaPath && local.javaPath.toLowerCase() === j.path.toLowerCase();
                return (
                  <div
                    key={j.path}
                    className={'java-row' + (active ? ' selected' : '')}
                    onClick={() => apply({ javaPath: j.path })}
                    title={j.path}
                  >
                    <div className="java-row-main">
                      <div className="java-row-head">
                        <span>Java {j.major}</span>
                        <span className="muted mono" style={{ fontSize: 12 }}>{j.version}</span>
                        {j.managed && <span className="chip success"><IconCheck /> встроенная</span>}
                        {j.vendor && !j.managed && <span className="chip">{j.vendor}</span>}
                      </div>
                      <div className="java-row-path">{j.path}</div>
                    </div>
                    {active && <span className="chip accent"><IconCheck /> выбрано</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Свой путь (перекрывает авто-выбор)</label>
          <div className="row">
            <input
              className="input mono"
              placeholder="Оставьте пустым для автоматического выбора"
              value={local.javaPath || ''}
              onChange={(e) => apply({ javaPath: e.target.value })}
            />
            <button className="btn ghost" onClick={() => apply({ javaPath: undefined })} disabled={!local.javaPath}>
              Сбросить
            </button>
          </div>
          <div className="hint">
            Несовместимые версии игнорируются автоматически — например, Java 21 для мира 1.16.
          </div>
        </div>
      </div>

      <div className="card danger-zone">
        <div className="card-head">
          <h2>Опасная зона</h2>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>Сброс лаунчера</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Удалит скачанные версии, библиотеки и кеш. Можно сохранить личные данные или стереть всё подчистую.
            </div>
          </div>
          <button className="btn danger" onClick={onResetLauncher}>
            <IconAlert /> Сбросить лаунчер
          </button>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', gap: 12, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4 }}>Удалить лаунчер</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Запустит штатный uninstaller Windows. Можно сохранить миры и аккаунты или стереть всё.
            </div>
          </div>
          <button className="btn danger" onClick={onUninstallLauncher}>
            <IconTrash /> Удалить лаунчер
          </button>
        </div>
      </div>
    </div>
  );
};
