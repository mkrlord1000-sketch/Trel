import React, { useEffect, useState } from 'react';
import type { LoaderType, LoaderVersionInfo } from '../../preload/preload';
import { IconRefresh, IconCheck } from './icons';

interface Props {
  mcVersion: string;
  open: boolean;
  onClose: () => void;
  onInstalled: (versionId: string) => void;
}

const LOADERS: { id: LoaderType; label: string; hint: string }[] = [
  { id: 'fabric',   label: 'Fabric',   hint: 'Лёгкий, быстрый, самый популярный для свежих версий' },
  { id: 'quilt',    label: 'Quilt',    hint: 'Форк Fabric с расширенным API' },
  { id: 'neoforge', label: 'NeoForge', hint: 'Форк Forge для современных версий (1.20.1+)' },
  { id: 'forge',    label: 'Forge',    hint: 'Классический мод-загрузчик, нужен для старых модпаков' },
];

export const LoaderInstallDialog: React.FC<Props> = ({ mcVersion, open, onClose, onInstalled }) => {
  const [loader, setLoader] = useState<LoaderType>('fabric');
  const [versions, setVersions] = useState<LoaderVersionInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setVersions([]);
    setSelected('');
    setError('');
    setLoading(true);
    window.api.loaders.list(loader, mcVersion)
      .then((list) => {
        setVersions(list);
        if (list.length) setSelected(list[0].version);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [loader, mcVersion, open]);

  if (!open) return null;

  const onInstall = async () => {
    if (!selected) return;
    setInstalling(true);
    setError('');
    try {
      const { versionId } = await window.api.loaders.install(loader, mcVersion, selected);
      onInstalled(versionId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={installing ? undefined : onClose}>
      <div
        className="dialog"
        style={{ maxWidth: 540, alignItems: 'stretch' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-icon"><IconRefresh /></div>
        <div className="dialog-body">
          <h3 className="dialog-title">Установить мод-загрузчик для {mcVersion}</h3>

          <div className="loader-types">
            {LOADERS.map((l) => (
              <button
                key={l.id}
                className={'loader-type' + (loader === l.id ? ' active' : '')}
                onClick={() => setLoader(l.id)}
                disabled={installing}
              >
                <div className="loader-type-name">{l.label}</div>
                <div className="loader-type-hint">{l.hint}</div>
              </button>
            ))}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Версия загрузчика</label>
            {loading ? (
              <div className="empty" style={{ padding: 16 }}>Загрузка списка...</div>
            ) : versions.length === 0 ? (
              <div className="empty" style={{ padding: 16 }}>
                Нет доступных версий {LOADERS.find(l => l.id === loader)?.label} для {mcVersion}
              </div>
            ) : (
              <select
                className="select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={installing}
              >
                {versions.slice(0, 100).map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}{v.stable ? ' · стабильная' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}

          <div className="dialog-actions">
            <button className="btn ghost" onClick={onClose} disabled={installing}>
              Отмена
            </button>
            <button
              className="btn primary"
              onClick={onInstall}
              disabled={!selected || installing}
            >
              {installing ? 'Установка...' : <><IconCheck /> Установить</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
