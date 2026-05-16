import React, { useEffect, useMemo, useState } from 'react';
import type { ContentItem, ContentKind, InstalledVersionDetail, LoaderType } from '../../preload/preload';
import {
  IconCube, IconFolder, IconTrash, IconCheck, IconAlert, IconRefresh, IconArchive, IconSpark,
} from '../components/icons';
import { useDialog } from '../components/Dialog';

interface Props {
  lastVersionId?: string;
  onPickVersion: (versionId: string) => void;
}

const TABS: { id: ContentKind; label: string }[] = [
  { id: 'mod',          label: 'Моды' },
  { id: 'shader',       label: 'Шейдеры' },
  { id: 'resourcepack', label: 'Ресурс-паки' },
  { id: 'texturepack',  label: 'Текстур-паки' },
];

const loaderLabel: Record<LoaderType, string> = {
  fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge',
};

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

function prettyVersionName(d: InstalledVersionDetail): string {
  if (d.loader) return `${d.baseMc} + ${loaderLabel[d.loader]} ${d.loaderVersion ?? ''}`.trim();
  return d.id;
}

const KindIcon: Record<ContentKind, React.FC<any>> = {
  mod: IconCube,
  shader: IconSpark,
  resourcepack: IconArchive,
  texturepack: IconArchive,
};

const IconInfoLocal: React.FC<any> = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const ContentPage: React.FC<Props> = ({ lastVersionId, onPickVersion }) => {
  const dlg = useDialog();
  const [tab, setTab] = useState<ContentKind>('mod');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [details, setDetails] = useState<InstalledVersionDetail[]>([]);
  const [versionId, setVersionId] = useState<string>(lastVersionId ?? '');

  // Список доступных версий: лоадер впитывает ванильку, поэтому если для
  // базовой MC есть лоадер — оставляем только лоадер (как в Установленных).
  const availableVersions = useMemo(() => {
    const moddedBases = new Set(details.filter((d) => d.loader).map((d) => d.baseMc));
    return details.filter((d) => d.loader || !moddedBases.has(d.id));
  }, [details]);

  // Загружаем список установленных версий и при необходимости подбираем активную
  useEffect(() => {
    window.api.minecraft.installedDetailed().then((list) => {
      setDetails(list);
      // Если текущая выбранная не установлена, переключаемся на актуальную:
      // приоритет — lastVersionId, иначе первая доступная (после фильтрации).
      const ids = new Set(list.map((d) => d.id));
      if (!ids.has(versionId)) {
        const moddedBases = new Set(list.filter((d) => d.loader).map((d) => d.baseMc));
        const filtered = list.filter((d) => d.loader || !moddedBases.has(d.id));
        const last = lastVersionId && ids.has(lastVersionId)
          ? list.find((d) => d.id === lastVersionId)
          : null;
        const pick =
          (last && filtered.includes(last) ? last : null) ??
          filtered[0] ??
          list[0] ??
          null;
        if (pick) setVersionId(pick.id);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    if (!versionId) { setItems([]); return; }
    setLoading(true);
    try {
      const list = await window.api.content.list(tab, versionId);
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [tab, versionId]);

  const onAdd = async () => {
    if (!versionId) return;
    const res = await window.api.content.add(tab, versionId);
    if (res.copied > 0) {
      setStatus(`Добавлено: ${res.copied} ${pluralize(res.copied, 'файл', 'файла', 'файлов')}`);
      refresh();
    } else if (res.errors.length > 0) {
      setStatus('Ошибки: ' + res.errors.join('; '));
    }
  };

  const onDelete = async (it: ContentItem) => {
    if (!versionId) return;
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
    const ok = await window.api.content.delete(tab, it.name, versionId);
    if (ok) {
      setStatus(`Удалено: ${it.displayName}`);
      refresh();
    }
  };

  const onToggle = async (it: ContentItem) => {
    if (!versionId) return;
    const ok = await window.api.content.toggle(tab, it.name, versionId);
    if (ok) {
      setStatus(it.enabled ? `Отключено: ${it.displayName}` : `Включено: ${it.displayName}`);
      refresh();
    }
  };

  const tabLabel = TABS.find(t => t.id === tab)?.label || '';
  const totalSize = items.reduce((acc, it) => acc + it.size, 0);
  const Icon = KindIcon[tab];
  const currentDetail = details.find((d) => d.id === versionId) ?? null;
  const noVersionPicked = !versionId || !currentDetail;
  const isModdable = !!currentDetail?.loader;

  const placeholderHint =
    tab === 'mod'         ? 'Брось .jar файл сюда или нажми «+ Добавить файлы».' :
    tab === 'shader'      ? 'Брось .zip шейдер-пак сюда или нажми «+ Добавить файлы».' :
    tab === 'resourcepack'? 'Брось .zip ресурс-пак сюда или нажми «+ Добавить файлы».' :
                            'Брось .zip текстур-пак сюда или нажми «+ Добавить файлы».';

  return (
    <div>
      <div className="page-head">
        <h1>Контент</h1>
        <p>Моды, шейдеры, ресурс-паки и текстур-паки — у каждой версии свои</p>
      </div>

      {/* Переключатель версии */}
      <div className="content-version-bar">
        <label className="muted" style={{ fontSize: 12, marginRight: 8 }}>
          Версия:
        </label>
        <select
          className="select"
          value={versionId}
          onChange={(e) => {
            const id = e.target.value;
            setVersionId(id);
            onPickVersion(id);
          }}
          disabled={availableVersions.length === 0}
          style={{ minWidth: 260 }}
        >
          {availableVersions.length === 0 && (
            <option value="">— ничего не установлено —</option>
          )}
          {availableVersions.map((d) => (
            <option key={d.id} value={d.id}>{prettyVersionName(d)}</option>
          ))}
        </select>
        {currentDetail && (
          <span className="chip" style={{ marginLeft: 8 }} title={currentDetail.id}>
            папка: <code>versions/{currentDetail.id}</code>
          </span>
        )}
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

      {tab === 'mod' && !isModdable && currentDetail && (
        <div className="content-banner accent">
          <div className="content-banner-icon"><IconInfoLocal /></div>
          <div className="content-banner-body">
            <h3>Моды требуют загрузчик</h3>
            <p>
              На <b>{currentDetail.id}</b> установлена голая ванилла — моды не загрузятся.
              Установи <b>Fabric / Quilt / Forge / NeoForge</b> через каталог версий, затем кидай .jar моды сюда.
            </p>
          </div>
        </div>
      )}

      {noVersionPicked ? (
        <div className="content-empty">
          <div className="content-empty-icon"><IconCube /></div>
          <h2>Версия не выбрана</h2>
          <p>Установи хотя бы одну версию Minecraft через каталог, чтобы начать добавлять контент.</p>
        </div>
      ) : (
        <>
          <div className="content-toolbar">
            <button className="btn primary" onClick={onAdd}>
              + Добавить файлы
            </button>
            <button className="btn" onClick={() => window.api.content.openFolder(tab, versionId)}>
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
        </>
      )}
    </div>
  );
};
