import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DownloadProgress, LauncherSettings, MinecraftAccount, VersionInfo } from '../../shared/types';
import type { JavaPlan } from '../../preload/preload';
import {
  IconPlay, IconInfo, IconAlert, IconCheck, IconArrow,
  IconCube, IconRefresh,
} from '../components/icons';
import { describeVersion } from '../data/versions';

interface Props {
  settings: LauncherSettings;
  account: MinecraftAccount | null;
  onGoToAccounts: () => void;
  onGoToBrowse: () => void;
  onGoToInstalled: () => void;
  onSettingsChange: (s: LauncherSettings) => void;
}

const typeLabel: Record<string, string> = {
  release: 'релиз', snapshot: 'снапшот', old_beta: 'beta', old_alpha: 'alpha',
};

export const HomePage: React.FC<Props> = ({
  settings, account, onGoToAccounts, onGoToBrowse, onGoToInstalled, onSettingsChange,
}) => {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [busy, setBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [javaPlan, setJavaPlan] = useState<JavaPlan | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const lastId = settings.lastVersionId || '';

  useEffect(() => {
    window.api.minecraft.versions().then(setVersions).catch(() => {});
    window.api.minecraft.installed().then((list) => setInstalled(new Set(list)));

    const offProgress = window.api.minecraft.onProgress(setProgress);
    const offLog = window.api.minecraft.onLog((line) => setLogLines((p) => [...p.slice(-500), line]));
    const offExit = window.api.minecraft.onExit((code) => {
      setStatus(`Игра завершилась (код ${code})`);
      setStatusType(code === 0 ? 'success' : 'error');
      setBusy(false);
    });
    return () => { offProgress(); offLog(); offExit(); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines.length]);

  useEffect(() => {
    if (!lastId) { setJavaPlan(null); return; }
    let cancelled = false;
    window.api.java.planFor(lastId).then((p) => { if (!cancelled) setJavaPlan(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [lastId]);

  const lastVersion = useMemo(() => versions.find((v) => v.id === lastId), [versions, lastId]);
  const isInstalled = installed.has(lastId);
  const installedRecent = useMemo(() => {
    return [...installed]
      .filter((id) => id !== lastId)
      .map((id) => versions.find((v) => v.id === id))
      .filter((v): v is VersionInfo => !!v)
      .slice(0, 6);
  }, [installed, versions, lastId]);

  const canPlay = !!account && !!lastId && !busy;

  const onPlay = async () => {
    if (!account || !lastId) return;
    setBusy(true);
    setLogLines([]);
    setShowLog(false);
    setStatusType('neutral');
    try {
      if (!isInstalled) {
        // Не установлено — качаем сначала
        setStatus('Скачивание ' + lastId);
        await window.api.minecraft.install(lastId);
        const ids = await window.api.minecraft.installed();
        setInstalled(new Set(ids));
      }
      // Уже установлено — сразу запускаем без проверок
      setStatus('Запуск Minecraft');
      onSettingsChange({ ...settings, lastVersionId: lastId });
      await window.api.minecraft.launch({
        versionId: lastId, account, memoryMb: settings.memoryMb,
      });
      setStatus('Minecraft запущен');
      setStatusType('success');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
      setStatusType('error');
      setBusy(false);
    }
  };

  // Empty state — no last version yet
  if (!lastId) {
    return (
      <div className="home">
        <div className="home-hero empty-hero">
          <div className="home-hero-eyebrow">Aurora Launcher</div>
          <h1 className="home-hero-title">Готово к запуску</h1>
          <p className="home-hero-sub">
            Выберите версию Minecraft, чтобы начать. После первого запуска она появится здесь как «продолжить».
          </p>
          {!account && (
            <button className="btn primary lg" onClick={onGoToAccounts} style={{ marginTop: 16 }}>
              Сначала добавьте аккаунт <IconArrow />
            </button>
          )}
          {account && (
            <button className="btn primary lg" onClick={onGoToBrowse} style={{ marginTop: 16 }}>
              Открыть каталог версий <IconArrow />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      {/* Account banner */}
      {!account && (
        <div className="banner">
          <div>
            <h2>Нет активного аккаунта</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Добавьте профиль, чтобы начать игру</div>
          </div>
          <button className="btn primary" onClick={onGoToAccounts}>В аккаунты</button>
        </div>
      )}

      {/* Hero — continue playing */}
      <div className="home-hero">
        <div className="home-hero-eyebrow">
          {isInstalled ? 'Продолжить' : 'Последняя сессия'}
        </div>
        <div className="home-hero-row">
          <div className="home-hero-info">
            <div className="home-hero-title">{lastId}</div>
            <div className="home-hero-meta">
              {lastVersion && (
                <>
                  <span className={'tag ' + lastVersion.type}>{typeLabel[lastVersion.type] ?? lastVersion.type}</span>
                  <span className="chip">{new Date(lastVersion.releaseTime).toLocaleDateString('ru-RU')}</span>
                </>
              )}
              {javaPlan && !javaPlan.error && (
                <span className={'chip ' + (javaPlan.plan === 'download' ? 'warn' : 'accent')}>
                  Java {javaPlan.required}
                  {javaPlan.plan === 'reuse' && <> · найдена</>}
                  {javaPlan.plan === 'download' && <> · скачается</>}
                </span>
              )}
              <span className={'chip ' + (isInstalled ? 'success' : '')}>
                {isInstalled ? <><IconCheck /> установлено</> : 'будет скачано'}
              </span>
            </div>

            {lastVersion && describeVersion(lastVersion) && (
              <p className="home-hero-desc">{describeVersion(lastVersion)}</p>
            )}
          </div>

          <button className="play-btn home-play" disabled={!canPlay} onClick={onPlay}>
            {busy && progress && (
              <span className="progress-fill" style={{ width: progress.percent + '%' }} />
            )}
            <span className="label">
              <IconPlay />
              {busy ? (isInstalled ? 'Запуск...' : 'Скачивание...') : 'Играть'}
            </span>
          </button>
        </div>

        {(busy && progress) && (
          <div className="hero-progress">
            <div className="ab-progress-info">
              <span className="ab-progress-stage">{progress.stage}</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="ab-progress-bar">
              <div className="fill" style={{ width: progress.percent + '%' }} />
            </div>
          </div>
        )}

        {status && !busy && (
          <div className={'status-line ' + statusType} style={{ marginTop: 14 }}>
            {statusType === 'error' ? <IconAlert /> : statusType === 'success' ? <IconCheck /> : <IconInfo />}
            <span>{status}</span>
          </div>
        )}
      </div>

      {/* Quick tiles */}
      <div className="home-tiles">
        <button className="home-tile" onClick={onGoToBrowse}>
          <div className="home-tile-icon"><IconCube /></div>
          <div className="home-tile-body">
            <div className="home-tile-title">Каталог версий</div>
            <div className="home-tile-sub">Найти и установить любую</div>
          </div>
          <IconArrow />
        </button>
        <button className="home-tile" onClick={onGoToInstalled}>
          <div className="home-tile-icon"><IconRefresh /></div>
          <div className="home-tile-body">
            <div className="home-tile-title">Установленные</div>
            <div className="home-tile-sub">{installed.size} {pluralize(installed.size, 'версия', 'версии', 'версий')}</div>
          </div>
          <IconArrow />
        </button>
      </div>

      {/* Recently used */}
      {installedRecent.length > 0 && (
        <div className="home-section">
          <div className="home-section-head">
            <h2>Другие установленные</h2>
            <button className="btn ghost sm" onClick={onGoToInstalled}>Все</button>
          </div>
          <div className="home-recent">
            {installedRecent.map((v) => (
              <button
                key={v.id}
                className="recent-card"
                onClick={() => {
                  onSettingsChange({ ...settings, lastVersionId: v.id });
                }}
                title={`Сделать активной: ${v.id}`}
              >
                <div className="recent-name">{v.id}</div>
                <span className={'tag ' + v.type}>{typeLabel[v.type] ?? v.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Log card */}
      {logLines.length > 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <div className="row" style={{ gap: 8 }}>
              <h2>Лог игры</h2>
              <span className="chip">{logLines.length} строк</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn ghost sm" onClick={() => setShowLog((v) => !v)}>
                {showLog ? 'Скрыть' : 'Показать'}
              </button>
              <button className="btn ghost sm" onClick={() => setLogLines([])}>Очистить</button>
            </div>
          </div>
          {showLog && <div className="log" ref={logRef}>{logLines.join('')}</div>}
        </div>
      )}
    </div>
  );
};

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
