import React, { useState } from 'react';
import { IconArrow, IconSpark } from '../components/icons';

interface Props {
  onDone: () => void;
}

export const WelcomePage: React.FC<Props> = ({ onDone }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!name.trim()) return;
    setError('');
    setLoading(true);
    try {
      await window.api.accounts.addGuest(name);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-logo">
          <IconSpark />
        </div>
        <h1 className="welcome-title">Добро пожаловать</h1>
        <p className="welcome-sub">Выберите никнейм, чтобы начать. Он сохранится и будет использоваться при следующих запусках.</p>

        <div className="field" style={{ marginTop: 24 }}>
          <label>Никнейм</label>
          <input
            autoFocus
            className="input"
            placeholder="Steve"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            maxLength={16}
          />
          <div className="hint">1–16 символов: латинские буквы, цифры, подчёркивание</div>
        </div>

        {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}

        <button
          className="btn primary lg block"
          disabled={loading || !name.trim()}
          onClick={submit}
          style={{ marginTop: 16 }}
        >
          {loading ? 'Сохранение...' : <>Продолжить <IconArrow /></>}
        </button>

        <div className="hint" style={{ marginTop: 20, textAlign: 'center' }}>
          Хранится локально в <code>%APPDATA%\Trel</code>
        </div>
      </div>
    </div>
  );
};
