import React, { useState } from 'react';
import type { MinecraftAccount } from '../../shared/types';
import { IconTrash, IconSkin } from '../components/icons';
import { SkinFace } from '../components/SkinPreview';

interface Props {
  accounts: MinecraftAccount[];
  activeUuid: string | null;
  onSelect: (uuid: string) => void;
  onChange: () => void;
  onGoToSkin: () => void;
}

export const AccountsPage: React.FC<Props> = ({ accounts, activeUuid, onSelect, onChange, onGoToSkin }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const addGuest = async () => {
    if (!name.trim()) return;
    setError('');
    setLoading(true);
    try {
      await window.api.accounts.addGuest(name);
      setName('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (uuid: string) => {
    await window.api.accounts.remove(uuid);
    onChange();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Аккаунты</h1>
        <p>Гостевые профили, сохранённые на этом компьютере</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Добавить гостя</h2>
        </div>
        <div className="row">
          <input
            className="input"
            placeholder="Steve"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addGuest(); }}
            maxLength={16}
          />
          <button className="btn primary" onClick={addGuest} disabled={loading || !name.trim()}>
            Добавить
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Работает в одиночной игре и на серверах с <code>online-mode=false</code>.
        </div>
        {error && <div className="hint" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Сохранённые аккаунты</h2>
          <span className="chip">{accounts.length}</span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty">Пока нет аккаунтов</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {accounts.map((a) => (
              <div
                key={a.uuid}
                className={'account-tile' + (activeUuid === a.uuid ? ' active' : '')}
                onClick={() => onSelect(a.uuid)}
              >
                <SkinFace skin={a.skin ?? null} size={40} fallbackName={a.name} className="account-avatar" />
                <div className="info">
                  <div className="name">{a.name}</div>
                  <div className="role">Гость{activeUuid === a.uuid ? ' · активный' : ''}</div>
                </div>
                <button
                  className="icon-btn"
                  onClick={(e) => { e.stopPropagation(); onSelect(a.uuid); onGoToSkin(); }}
                  title="Скин"
                >
                  <IconSkin />
                </button>
                <button
                  className="icon-btn"
                  onClick={(e) => { e.stopPropagation(); remove(a.uuid); }}
                  title="Удалить"
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
