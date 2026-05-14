import React, { useEffect, useState } from 'react';
import type { WorldEntry } from '../../preload/preload';
import { IconFolder, IconTrash, IconRefresh, IconArchive } from '../components/icons';
import { useDialog } from '../components/Dialog';

const modeLabel = (m: number | undefined, hardcore: boolean | undefined) => {
  if (hardcore) return 'хардкор';
  switch (m) {
    case 0: return 'выживание';
    case 1: return 'креатив';
    case 2: return 'приключение';
    case 3: return 'наблюдатель';
    default: return '—';
  }
};

const modeTag = (m: number | undefined, hardcore: boolean | undefined) => {
  if (hardcore) return 'old_alpha';
  switch (m) {
    case 1: return 'snapshot';
    case 2: return 'neutral';
    case 3: return 'neutral';
    default: return 'release';
  }
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  if (bytes < 1024 ** 3) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
  return (bytes / (1024 ** 3)).toFixed(2) + ' ГБ';
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export const WorldsPage: React.FC = () => {
  const dialog = useDialog();
  const [list, setList] = useState<WorldEntry[]>([]);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const worlds = await window.api.worlds.list();
      setList(worlds);
      // fetch icons lazily
      const iconEntries = await Promise.all(
        worlds.filter((w) => w.hasIcon).map(async (w) => [w.name, await window.api.worlds.icon(w.name)] as const)
      );
      setIcons(Object.fromEntries(iconEntries));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const filtered = list.filter((w) =>
    !query || w.displayName.toLowerCase().includes(query.toLowerCase()) || w.name.toLowerCase().includes(query.toLowerCase()),
  );

  const onDelete = async (w: WorldEntry) => {
    const choice = await dialog.show({
      title: `Удалить мир «${w.displayName}»?`,
      tone: 'danger',
      message: (
        <>
          Это действие необратимо.
          <br />
          <b>Удалить полностью</b> — стирает мир и все его .zip-бэкапы.
          <br />
          <b>Только мир</b> — мир удаляется, бэкапы в папке <code>backups</code> остаются.
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Только мир', value: 'world', variant: 'default' },
        { label: 'Удалить полностью', value: 'all', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });

    if (choice === 'cancel') return;

    if (choice === 'all') {
      const r = await window.api.worlds.deleteWithBackups(w.name);
      setStatus(`«${w.displayName}» удалён${r.backupsRemoved ? `, бэкапов удалено: ${r.backupsRemoved}` : ''}`);
    } else {
      const ok = await window.api.worlds.delete(w.name);
      if (ok) setStatus(`Мир «${w.displayName}» удалён (бэкапы сохранены)`);
    }
    refresh();
  };

  const onBackup = async (w: WorldEntry) => {
    setStatus(`Создание бэкапа «${w.displayName}»...`);
    try {
      const out = await window.api.worlds.backup(w.name);
      setStatus(`Бэкап сохранён: ${out}`);
    } catch (e) {
      setStatus('Ошибка бэкапа: ' + (e as Error).message);
    }
  };

  const totalSize = list.reduce((acc, w) => acc + w.sizeBytes, 0);

  return (
    <div>
      <div className="page-head">
        <h1>Миры</h1>
        <p>Каталог ваших сохранений · {list.length} миров · {fmtSize(totalSize)} на диске</p>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row" style={{ flex: 1, gap: 8 }}>
            <input
              className="input"
              placeholder="Поиск мира"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, maxWidth: 320 }}
            />
            <button className="btn ghost sm" onClick={refresh} disabled={loading}>
              <IconRefresh /> Обновить
            </button>
          </div>
          <button className="btn ghost sm" onClick={() => window.api.worlds.openFolder()}>
            <IconFolder /> Папка saves
          </button>
        </div>

        {status && (
          <div className="hint" style={{ marginBottom: 10 }}>{status}</div>
        )}

        {loading ? (
          <div className="empty">Загрузка миров...</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {list.length === 0
              ? 'Нет ни одного мира. Создайте новый в Minecraft — он появится здесь.'
              : 'Ни один мир не соответствует поисковому запросу.'}
          </div>
        ) : (
          <div className="world-grid">
            {filtered.map((w) => (
              <div key={w.name} className="world-card">
                <div className="world-icon">
                  {icons[w.name] ? (
                    <img src={icons[w.name]!} alt="" />
                  ) : (
                    <div className="world-icon-placeholder">{w.displayName.charAt(0).toUpperCase()}</div>
                  )}
                </div>
                <div className="world-body">
                  <div className="world-title" title={w.displayName}>{w.displayName}</div>
                  <div className="world-meta">
                    <span className={'tag ' + modeTag(w.gameMode, w.hardcore)}>{modeLabel(w.gameMode, w.hardcore)}</span>
                    {w.version && <span className="chip">{w.version}</span>}
                    <span className="chip">{fmtSize(w.sizeBytes)}</span>
                  </div>
                  <div className="world-sub mono" title={w.name}>{w.name}</div>
                  <div className="world-sub">Последний запуск: {fmtDate(w.lastPlayed)}</div>
                </div>
                <div className="world-actions">
                  <button
                    className="icon-btn"
                    onClick={() => window.api.worlds.openFolder(w.name)}
                    title="Открыть папку"
                  ><IconFolder /></button>
                  <button
                    className="icon-btn"
                    onClick={() => onBackup(w)}
                    title="Создать .zip бэкап"
                  ><IconArchive /></button>
                  <button
                    className="icon-btn"
                    onClick={() => onDelete(w)}
                    title="Удалить мир"
                  ><IconTrash /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
