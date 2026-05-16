import React, { useEffect, useState } from 'react';
import type { ContentItem, ContentKind } from '../../preload/preload';
import {
  IconCube, IconFolder, IconTrash, IconCheck, IconAlert, IconRefresh, IconArchive, IconSpark,
} from '../components/icons';
import { useDialog } from '../components/Dialog';

const TABS: { id: ContentKind; label: string }[] = [
  { id: 'mod',          label: 'Моды' },
  { id: 'shader',       label: 'Шейдеры' },
  { id: 'resourcepack', label: 'Ресурс-паки' },
  { id: 'texturepack',  label: 'Текстур-паки' },
];

function fmtSize(b: number): string {
  if (b < 1024) return b + ' Б';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' КБ';
  if (b < 1024 ** 3) return (b / (1024 * 1024)).toFixed(1) + ' МБ';
  return (b / (1024 ** 3)).toFixed(2) + ' ГБ';
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const KindIcon: Record<ContentKind, React.FC<any>> = {
  mod: IconCube,
  shader: IconSpark,
  resourcepack: IconArchive,
  texturepack: IconArchive,
};

export const ContentPage: React.FC = () => {
  const dlg = useDialog();
  const [tab, setTab] = useState<ContentKind>('mod');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await window.api.content.list(tab);
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [tab]);

  const onAdd = async () => {
    const res = await window.api.content.add(tab);
    if (res.copied > 0) {
      setStatus(`Добавлено: ${res.copied} ${pluralize(res.copied, 'файл', 'файла', 'файлов')}`);
      refresh();
    } else if (res.errors.length > 0) {
      setStatus('Ошибки: ' + res.errors.join('; '));
    }
  };

  const onDelete = async (it: ContentItem) => {
    const choice = await dlg.show({
      title: `Удалить «${it.displayName}»?`,
      tone: 'danger',
      message: 'Файл будет удалён без возможности восстановления.',
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Удалить', value: 'ok', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (choice !== 'ok') return;
    const ok = await window.api.content.delete(tab, it.name);
    if (ok) {
      setStatus(`Удалено: ${it.displayName}`);
      refresh();
    }
  };

  const onToggle = async (it: ContentItem) => {
    const ok = await window.api.content.toggle(tab, it.name);
    if (ok) {
      setStatus(it.enabled ? `Отключено: ${it.displayName}` : `Включено: ${it.displayName}`);
      refresh();
    }
  };

  const tabLabel = TABS.find(t => t.id === tab)?.label || '';
  const totalSize = items.reduce((acc, it) => acc + it.size, 0);
  const Icon = KindIcon[tab];

  const placeholderHint =
    tab === 'mod'         ? 'Брось .jar файл сюда или нажми «+ Добавить файлы».' :
    tab === 'shader'      ? 'Брось .zip шейдер-пак сюда или нажми «+ Добавить файлы».' :
    tab === 'resourcepack'? 'Брось .zip ресурс-пак сюда или нажми «+ Добавить файлы».' :
                            'Брось .zip текстур-пак сюда или нажми «+ Добавить файлы».';

  return (
    <div>
      <div className="page-head">
        <h1>Контент</h1>
        <p>Моды, шейдеры, ресурс-паки и текстур-паки в общей папке игры</p>
      </div>

      <div className="content-tabs">
        {TABS.map(t => {
          const T = KindIcon[t.id];
          return (
            <button
              key={t.id}
              className={'content-tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
            >
              <T />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'shader' && (
        <div className="content-banner info">
          <div className="content-banner-icon"><IconAlert /></div>
          <div className="content-banner-body">
            <h3>Нужен шейдер-загрузчик</h3>
            <p>
              Шейдер-паки сами по себе не работают — установи <b>Iris</b> (для Fabric/Quilt) или
              <b> OptiFine</b> (для Forge / vanilla), затем брось .zip файл сюда. Без них папка просто игнорируется.
            </p>
          </div>
        </div>
      )}

      {tab === 'texturepack' && (
        <div className="content-banner warn">
          <div className="content-banner-icon"><IconAlert /></div>
          <div className="content-banner-body">
            <h3>Только для версий до 1.6</h3>
            <p>
              Папка <code>texturepacks</code> работает только на старых версиях (Beta, 1.0–1.5).
              Для 1.6+ используй вкладку <b>Ресурс-паки</b>.
            </p>
          </div>
        </div>
      )}

      {tab === 'mod' && (
        <div className="content-banner accent">
          <div className="content-banner-icon"><IconInfo /></div>
          <div className="content-banner-body">
            <h3>Моды требуют загрузчик</h3>
            <p>
              Моды работают только с <b>Fabric / Quilt / Forge / NeoForge</b>. Установи нужный
              загрузчик через каталог версий, затем кидай .jar моды сюда.
            </p>
          </div>
        </div>
      )}

      <div className="content-toolbar">
        <button className="btn primary" onClick={onAdd}>
          + Добавить файлы
        </button>
        <button className="btn" onClick={() => window.api.content.openFolder(tab)}>
          <IconFolder /> Открыть папку
        </button>
        <button className="btn ghost sm" onClick={refresh} disabled={loading}>
          <IconRefresh /> Обновить
        </button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {items.length} {pluralize(items.length, 'файл', 'файла', 'файлов')} · {fmtSize(totalSize)}
        </span>
      </div>

      {status && <div className="hint" style={{ marginBottom: 10 }}>{status}</div>}

      {loading ? (
        <div className="empty">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="content-empty">
          <div className="content-empty-icon"><Icon /></div>
          <h2>Пока пусто</h2>
          <p>В папке <code>{tabLabel.toLowerCase()}</code> ничего нет.<br />{placeholderHint}</p>
        </div>
      ) : (
        <div className="content-grid">
          {items.map(it => {
            const ItemIcon = KindIcon[tab];
            return (
              <div key={it.name} className={'content-card' + (it.enabled ? '' : ' disabled')}>
                <div className="content-icon"><ItemIcon /></div>
                <div className="content-body">
                  <div className="content-name" title={it.name}>{it.displayName}</div>
                  <div className="content-meta">
                    <span className="chip">{fmtSize(it.size)}</span>
                    {it.isFolder && <span className="chip">папка</span>}
                    {!it.enabled && <span className="chip warn">отключён</span>}
                  </div>
                </div>
                <div className="content-actions">
                  {tab === 'mod' && (
                    <button
                      className="icon-btn"
                      onClick={() => onToggle(it)}
                      title={it.enabled ? 'Отключить' : 'Включить'}
                    >
                      {it.enabled ? <IconCheck /> : <IconAlert />}
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => onDelete(it)}
                    title="Удалить"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// IconInfo может быть не импортирован — добавим локально, чтобы не дёргать icons.tsx
const IconInfo: React.FC<any> = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
