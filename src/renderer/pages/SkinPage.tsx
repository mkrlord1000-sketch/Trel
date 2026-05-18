import React, { useEffect, useRef, useState } from 'react';
import type { MinecraftAccount } from '../../shared/types';
import type { InstalledVersionDetail } from '../../preload/preload';
import { IconTrash, IconSkin, IconSkinOff } from '../components/icons';
import { SkinFace, SkinBody } from '../components/SkinPreview';
import { SKIN_PRESETS, SkinPreset } from '../data/skin-presets';
import { supportsCustomSkin } from '../../shared/skin-support';

interface Props {
  accounts: MinecraftAccount[];
  activeUuid: string | null;
  onSelect: (uuid: string) => void;
  onChange: () => void;
  onGoToAccounts: () => void;
}

/**
 * Прочитать .png файл как data-URL и провалидировать размеры (64×64 или 64×32).
 */
const readPngFromFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!/\.png$/i.test(file.name) && file.type !== 'image/png') {
      return reject(new Error('Нужен PNG-файл'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('Файл не является корректной картинкой'));
      img.onload = () => {
        if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
          return reject(new Error(`Скин должен быть 64×64 или 64×32, а у тебя ${img.width}×${img.height}`));
        }
        resolve(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

const validateDataUrlSize = (dataUrl: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Файл не является корректной картинкой'));
    img.onload = () => {
      if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
        reject(new Error(`Скин должен быть 64×64 или 64×32, а у тебя ${img.width}×${img.height}`));
      } else {
        resolve();
      }
    };
    img.src = dataUrl;
  });

export const SkinPage: React.FC<Props> = ({ accounts, activeUuid, onSelect, onChange, onGoToAccounts }) => {
  const [error, setError] = useState<string>('');
  const [presetCat, setPresetCat] = useState<'all' | 'male' | 'female' | 'neutral'>('all');
  const [unsupportedInstalled, setUnsupportedInstalled] = useState<InstalledVersionDetail[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);

  const active = accounts.find((a) => a.uuid === activeUuid) ?? null;

  // Подгружаем установленные версии и фильтруем те, где скин не работает,
  // чтобы показать пользователю предупреждение прямо на этой странице.
  useEffect(() => {
    let cancelled = false;
    window.api.minecraft.installedDetailed().then((list) => {
      if (cancelled) return;
      setUnsupportedInstalled(
        list.filter((d) => !supportsCustomSkin(d.id, d.baseMc)),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const applySkin = async (uuid: string, dataUrl: string, model?: 'classic' | 'slim') => {
    setError('');
    try {
      const acc = accounts.find((a) => a.uuid === uuid);
      const m = model ?? acc?.skinModel ?? 'classic';
      await window.api.accounts.setSkin(uuid, dataUrl, m);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onPickSkin = async () => {
    if (!active) return;
    setError('');
    try {
      const dataUrl = await window.api.accounts.pickSkinFile();
      if (!dataUrl) return;
      await validateDataUrlSize(dataUrl);
      await applySkin(active.uuid, dataUrl);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onRemoveSkin = async () => {
    if (!active) return;
    await window.api.accounts.removeSkin(active.uuid);
    onChange();
  };

  const onPickModel = async (model: 'classic' | 'slim') => {
    if (!active || !active.skin) return;
    if (active.skinModel === model) return;
    await applySkin(active.uuid, active.skin, model);
  };

  const onPickPreset = async (preset: SkinPreset) => {
    if (!active) return;
    await applySkin(active.uuid, preset.dataUrl, preset.model);
  };

  const filteredPresets = presetCat === 'all'
    ? SKIN_PRESETS
    : SKIN_PRESETS.filter((p) => p.category === presetCat);

  const isCurrentPreset = (preset: SkinPreset): boolean =>
    !!active?.skin && active.skin === preset.dataUrl;

  // Drag&drop PNG прямо на превью
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const onOver = (e: DragEvent) => { e.preventDefault(); el.classList.add('dragover'); };
    const onLeave = () => el.classList.remove('dragover');
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      el.classList.remove('dragover');
      if (!active) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readPngFromFile(file);
        await applySkin(active.uuid, dataUrl);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [active?.uuid, accounts]);

  if (accounts.length === 0) {
    return (
      <div>
        <div className="page-head">
          <h1>Скин</h1>
          <p>Кастомный скин для активного аккаунта</p>
        </div>
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Сначала добавь аккаунт</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
            Скин привязывается к конкретному гостевому профилю.
          </p>
          <button className="btn primary" onClick={onGoToAccounts}>В аккаунты</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1>Скин</h1>
        <p>Кастомный скин для активного аккаунта</p>
      </div>

      {/* Переключатель аккаунтов, если их несколько */}
      {accounts.length > 1 && (
        <div className="card">
          <div className="card-head">
            <h2>Аккаунт</h2>
            <span className="chip">{accounts.length}</span>
          </div>
          <div className="skin-account-list">
            {accounts.map((a) => (
              <button
                key={a.uuid}
                className={'skin-account-pill' + (activeUuid === a.uuid ? ' active' : '')}
                onClick={() => onSelect(a.uuid)}
              >
                <SkinFace skin={a.skin ?? null} size={28} fallbackName={a.name} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {active && (
        <div className="card skin-card">
          <div className="card-head">
            <h2>{active.name}</h2>
            {active.skin && (
              <span className="chip accent">
                {active.skinModel === 'slim' ? 'Alex (slim)' : 'Steve (classic)'}
              </span>
            )}
          </div>

          <div className="skin-card-body">
            <div className="skin-preview-wrap" ref={dropRef}>
              {active.skin ? (
                <SkinBody skin={active.skin} model={active.skinModel ?? 'classic'} height={256} />
              ) : (
                <div className="skin-empty">
                  <IconSkin className="skin-empty-icon" />
                  <div className="skin-empty-text">Скин не загружен</div>
                  <div className="skin-empty-sub">Перетащи PNG сюда</div>
                </div>
              )}
            </div>

            <div className="skin-controls">
              <div className="skin-section-title">Файл скина</div>
              <div className="skin-tip">
                PNG 64×64 (современный) или 64×32 (legacy). Можно перетащить файл прямо на превью.
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={onPickSkin}>
                  Выбрать файл
                </button>
                {active.skin && (
                  <button className="btn ghost" onClick={onRemoveSkin}>
                    <IconTrash /> Сбросить
                  </button>
                )}
              </div>

              {active.skin && (
                <>
                  <div className="skin-section-title" style={{ marginTop: 14 }}>Модель</div>
                  <div className="skin-model-toggle">
                    <button
                      className={'skin-model-btn' + (active.skinModel !== 'slim' ? ' active' : '')}
                      onClick={() => onPickModel('classic')}
                    >
                      <span className="skin-model-name">Steve</span>
                      <span className="skin-model-sub">classic · руки 4px</span>
                    </button>
                    <button
                      className={'skin-model-btn' + (active.skinModel === 'slim' ? ' active' : '')}
                      onClick={() => onPickModel('slim')}
                    >
                      <span className="skin-model-name">Alex</span>
                      <span className="skin-model-sub">slim · руки 3px</span>
                    </button>
                  </div>
                </>
              )}

              {error && (
                <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>
              )}

              <div className="hint" style={{ marginTop: 12, fontSize: 12 }}>
                Скин виден и в лаунчере, и внутри игры. Для отображения в Minecraft 1.6+
                используется authlib-injector — лаунчер автоматически скачает агент
                (≈80 КБ) при первом запуске. На pre-1.6 версиях кастомный скин в игре
                не работает (старые версии скинов через sessionserver не запрашивают).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Галерея пресетов */}
      {active && (
        <div className="card">
          <div className="card-head">
            <h2>Пресеты</h2>
            <div className="row" style={{ gap: 4 }}>
              {(['all', 'male', 'female', 'neutral'] as const).map((cat) => (
                <button
                  key={cat}
                  className={'btn sm ' + (presetCat === cat ? 'primary' : 'ghost')}
                  onClick={() => setPresetCat(cat)}
                >
                  {cat === 'all' ? 'Все' :
                    cat === 'male' ? 'Муж' :
                    cat === 'female' ? 'Жен' :
                    'Без пола'}
                </button>
              ))}
            </div>
          </div>

          <div className="skin-preset-grid">
            {filteredPresets.map((p) => (
              <button
                key={p.id}
                className={'skin-preset-card' + (isCurrentPreset(p) ? ' active' : '')}
                onClick={() => onPickPreset(p)}
                title={p.description}
              >
                <div className="skin-preset-preview">
                  <SkinBody skin={p.dataUrl} model={p.model} height={112} />
                </div>
                <div className="skin-preset-info">
                  <div className="skin-preset-name">{p.name}</div>
                  <div className="skin-preset-cat">
                    {p.category === 'male' ? 'мужской' :
                      p.category === 'female' ? 'женский' :
                      'без пола'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Версии без поддержки скинов */}
      {active && unsupportedInstalled.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>
              <IconSkinOff style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Без поддержки скинов
            </h2>
            <span className="chip">{unsupportedInstalled.length}</span>
          </div>
          <div className="hint" style={{ marginBottom: 10, fontSize: 12.5 }}>
            На этих версиях кастомный скин в игре не появится. Так работает сам Minecraft —
            до 1.6 клиент не запрашивает скины через sessionserver. На таких версиях
            authlib-injector не подключается, и в игре будет default-Steve/Alex по UUID.
            В лаунчере (аватар, превью) скин по-прежнему виден.
          </div>
          <div className="skin-unsupported-list">
            {unsupportedInstalled.map((it) => (
              <div key={it.id} className="skin-unsupported-row">
                <IconSkinOff />
                <span className="skin-unsupported-id">{it.id}</span>
                {it.loader && (
                  <span className="chip accent">+ {it.loader}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
