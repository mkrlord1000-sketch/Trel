import React, { useEffect, useRef, useState } from 'react';
import type {
  ServerInstance, ServerStatus, ServerProperties, ServerCreateProgress,
} from '../../preload/preload';
import type { VersionInfo } from '../../shared/types';
import {
  IconPlay, IconStop, IconTrash, IconFolder,
  IconTerminal, IconPlus, IconServer, IconAlert, IconCopy,
} from '../components/icons';
import { useDialog } from '../components/Dialog';

const statusLabel: Record<ServerStatus, string> = {
  stopped: 'Остановлен',
  starting: 'Запускается',
  running: 'Работает',
  stopping: 'Останавливается',
  error: 'Ошибка',
};

const statusTone: Record<ServerStatus, string> = {
  stopped: 'neutral',
  starting: 'accent',
  running: 'success',
  stopping: 'warn',
  error: 'danger',
};

export const ServersPage: React.FC = () => {
  const dialog = useDialog();
  const [list, setList] = useState<ServerInstance[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const refreshList = async () => {
    const [l, st] = await Promise.all([
      window.api.servers.list(),
      window.api.servers.statuses(),
    ]);
    setList(l);
    setStatuses(st);
    if (!activeId && l.length > 0) setActiveId(l[0].id);
  };

  useEffect(() => {
    refreshList();
    const offLog = window.api.servers.onLog((id, line) => {
      setLogs((prev) => {
        const arr = (prev[id] ?? []).slice();
        arr.push(line);
        if (arr.length > 1000) arr.shift();
        return { ...prev, [id]: arr };
      });
    });
    const offStatus = window.api.servers.onStatus((id, s) => {
      setStatuses((prev) => ({ ...prev, [id]: s }));
    });
    return () => { offLog(); offStatus(); };
  }, []);

  // Подгружаем буфер логов для активного сервера, если ещё не было
  useEffect(() => {
    if (!activeId) return;
    if (logs[activeId] !== undefined) return;
    window.api.servers.logBuffer(activeId).then((buf) => {
      setLogs((prev) => ({ ...prev, [activeId]: buf }));
    });
  }, [activeId]);

  // Автоскролл консоли
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeId, logs[activeId ?? '']?.length]);

  const active = list.find((s) => s.id === activeId) ?? null;
  const activeStatus: ServerStatus = active ? statuses[active.id] ?? 'stopped' : 'stopped';

  const onStart = async (id: string) => {
    setStatus('Запуск сервера...');
    try {
      await window.api.servers.start(id);
      setStatus('');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
    }
  };
  const onStop = async (id: string) => {
    setStatus('Остановка сервера...');
    try {
      await window.api.servers.stop(id);
      setStatus('');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
    }
  };
  const onDelete = async (s: ServerInstance) => {
    const choice = await dialog.show({
      title: `Удалить сервер «${s.name}»?`,
      tone: 'danger',
      message: 'Папка сервера со всеми мирами и настройками будет удалена с диска.',
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Удалить', value: 'ok', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (choice !== 'ok') return;
    try {
      await window.api.servers.delete(s.id);
      if (activeId === s.id) setActiveId(null);
      await refreshList();
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Серверы</h1>
        <p>Локальные Minecraft-серверы прямо в лаунчере</p>
      </div>

      {status && <div className="hint" style={{ marginBottom: 12 }}>{status}</div>}

      <div className="server-shell">
        <aside className="server-list">
          <div className="server-list-head">
            <span className="muted" style={{ fontSize: 13 }}>{list.length} {pluralize(list.length, 'сервер', 'сервера', 'серверов')}</span>
            <button className="btn primary sm" onClick={() => setShowCreate(true)}>
              <IconPlus /> Создать
            </button>
          </div>

          {showCreate && (
            <CreateServerForm
              onCancel={() => setShowCreate(false)}
              onCreated={async () => {
                setShowCreate(false);
                await refreshList();
              }}
            />
          )}

          {list.length === 0 && !showCreate ? (
            <div className="card" style={{ padding: 24, textAlign: 'center' }}>
              <div className="server-empty-icon"><IconServer /></div>
              <h2 style={{ fontSize: 15, marginBottom: 6 }}>Нет серверов</h2>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Нажмите «Создать» в шапке, чтобы поднять первый локальный сервер.
              </p>
            </div>
          ) : (
            <div className="server-list-items">
              {list.map((s) => {
                const st = statuses[s.id] ?? 'stopped';
                return (
                  <div
                    key={s.id}
                    className={'server-item' + (activeId === s.id ? ' active' : '')}
                    onClick={() => setActiveId(s.id)}
                  >
                    <div className={'server-item-dot ' + statusTone[st]} />
                    <div className="server-item-info">
                      <div className="server-item-name">{s.name}</div>
                      <div className="server-item-sub">
                        <span>{s.versionId}</span>
                        <span>·</span>
                        <span>:{s.properties.serverPort}</span>
                      </div>
                    </div>
                    <span className={'chip ' + statusTone[st]}>{statusLabel[st]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <main className="server-detail">
          {!active ? (
            <div className="catalog-empty">
              <div className="catalog-empty-icon"><IconServer /></div>
              <h2>Выберите сервер</h2>
              <p>Слева — список ваших серверов. Можно создать новый или открыть существующий.</p>
            </div>
          ) : (
            <ActiveServer
              server={active}
              status={activeStatus}
              logs={logs[active.id] ?? []}
              logRef={logRef}
              onStart={() => onStart(active.id)}
              onStop={() => onStop(active.id)}
              onDelete={() => onDelete(active)}
              onUpdate={async (patch) => {
                const next = await window.api.servers.setProperties(active.id, patch);
                setList((prev) => prev.map((x) => (x.id === next.id ? next : x)));
              }}
              onRename={async (name) => {
                const next = await window.api.servers.rename(active.id, name);
                setList((prev) => prev.map((x) => (x.id === next.id ? next : x)));
              }}
              onSetMemory={async (mb) => {
                const next = await window.api.servers.setMemory(active.id, mb);
                setList((prev) => prev.map((x) => (x.id === next.id ? next : x)));
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
};

// ─── Active server pane ─────────────────────────────────────────────────────

const ActiveServer: React.FC<{
  server: ServerInstance;
  status: ServerStatus;
  logs: string[];
  logRef: React.RefObject<HTMLDivElement>;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<ServerProperties>) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onSetMemory: (mb: number) => Promise<void>;
}> = ({ server, status, logs, logRef, onStart, onStop, onDelete, onUpdate, onRename, onSetMemory }) => {
  const [cmd, setCmd] = useState('');
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(server.name);
  const [addresses, setAddresses] = useState<{ label: string; host: string; port: number }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setName(server.name); }, [server.name]);

  // Адреса для подключения (localhost + IP в LAN). Пересчитываем при смене
  // сервера и при смене порта в настройках.
  useEffect(() => {
    let cancelled = false;
    window.api.servers.connectAddresses(server.id).then((arr) => {
      if (!cancelled) setAddresses(arr);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [server.id, server.properties.serverPort]);

  const isRunning = status === 'running' || status === 'starting';
  const isReady = status === 'running'; // именно «Done» — можно подключаться

  const onSendCommand = async () => {
    if (!cmd.trim()) return;
    try {
      await window.api.servers.sendCommand(server.id, cmd);
      setCmd('');
    } catch {
      // Если сервер не запущен — просто игнорируем (UI кнопка сама блокирует, но на всякий)
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  return (
    <>
      {/* Hero */}
      <div className="server-hero">
        <div className="server-hero-info">
          <div className="server-hero-eyebrow">
            <span className={'chip ' + statusTone[status]}>{statusLabel[status]}</span>
            <span className="chip">{server.versionId}</span>
          </div>
          {editName ? (
            <input
              className="input server-name-input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={async () => {
                setEditName(false);
                if (name.trim() && name !== server.name) await onRename(name);
              }}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setName(server.name); setEditName(false); }
              }}
            />
          ) : (
            <h2
              className="server-hero-title"
              onClick={() => setEditName(true)}
              title="Кликни чтобы переименовать"
            >
              {server.name}
            </h2>
          )}
          <div className="server-hero-meta">
            <span>порт {server.properties.serverPort}</span>
            <span>·</span>
            <span>{server.memoryMb} МБ ОЗУ</span>
            <span>·</span>
            <span>создан {new Date(server.createdAt).toLocaleDateString('ru-RU')}</span>
          </div>
        </div>

        <div className="server-hero-actions">
          {isRunning ? (
            <button className="btn danger" onClick={onStop} disabled={status === 'stopping'}>
              <IconStop /> Остановить
            </button>
          ) : (
            <button className="btn primary" onClick={onStart}>
              <IconPlay /> Запустить
            </button>
          )}
          <button className="icon-btn" onClick={() => window.api.servers.openFolder(server.id)} title="Открыть папку">
            <IconFolder />
          </button>
          <button className="icon-btn" onClick={onDelete} disabled={isRunning} title="Удалить сервер">
            <IconTrash />
          </button>
        </div>
      </div>

      {/* Подключение */}
      <div className="card server-connect-card">
        <div className="card-head">
          <h2>Как подключиться</h2>
          {isReady ? (
            <span className="chip success">сервер готов</span>
          ) : status === 'starting' ? (
            <span className="chip accent">подождите, сервер ещё стартует...</span>
          ) : (
            <span className="chip">сервер не запущен</span>
          )}
        </div>
        <ol className="server-connect-steps">
          <li>В Minecraft на главном экране нажмите <b>Сетевая игра</b>.</li>
          <li>Внизу экрана нажмите <b>По адресу</b> (в современных версиях — <b>Direct Connect</b>).</li>
          <li>Вставьте один из адресов ниже и нажмите <b>Подключиться к серверу</b>.</li>
        </ol>
        <div className="server-connect-list">
          {addresses.map((a) => {
            // Для default-порта 25565 адрес можно писать без `:25565` — это
            // понятнее. Но в кнопку копирования всё равно кладём явный.
            const display = a.port === 25565 ? a.host : `${a.host}:${a.port}`;
            const fullAddr = `${a.host}:${a.port}`;
            return (
              <div key={fullAddr} className="server-connect-row">
                <div className="server-connect-info">
                  <div className="server-connect-label">{a.label}</div>
                  <code className="server-connect-addr">{display}</code>
                </div>
                <button
                  className="btn ghost sm"
                  onClick={() => copyToClipboard(display)}
                  title="Скопировать адрес"
                >
                  <IconCopy /> {copied === display ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
            );
          })}
          {addresses.length === 1 && (
            <div className="hint" style={{ fontSize: 12 }}>
              Других сетевых интерфейсов не нашлось — друзья из локальной сети не смогут зайти.
              Подключитесь к локалке через Wi-Fi/кабель и адрес появится здесь.
            </div>
          )}
        </div>
        <div className="hint" style={{ fontSize: 12, marginTop: 10 }}>
          Друзья <b>в одной сети</b> (Wi-Fi/LAN) подключаются по «Локальная сеть». Для игры через
          интернет нужен <b>проброс порта {server.properties.serverPort} TCP</b> на роутере или туннель
          (Hamachi, Radmin VPN, Playit.gg).
          <br />
          <b>Не подключаются?</b> При первом запуске Windows может спросить разрешение
          для <code>java.exe</code> — нажмите «Разрешить доступ» во всех сетях. Если вы случайно
          закрыли окно: Пуск → «Брандмауэр Защитника Windows» → «Разрешение взаимодействия
          с приложением» → найти <code>java.exe</code> и поставить обе галочки.
        </div>
      </div>

      {/* Console */}
      <div className="card server-console-card">
        <div className="card-head">
          <h2><IconTerminal style={{ verticalAlign: 'middle', marginRight: 6 }} /> Консоль</h2>
          <span className="chip">{logs.length} строк</span>
        </div>
        <div className="server-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="muted" style={{ padding: '20px 8px', fontSize: 12.5 }}>
              {isRunning ? 'Ждём первого вывода сервера...' : 'Запустите сервер чтобы увидеть консоль.'}
            </div>
          ) : (
            logs.map((line, i) => <span key={i}>{line}</span>)
          )}
        </div>
        <div className="server-cmd-row">
          <span className="server-cmd-prompt">/</span>
          <input
            className="input"
            placeholder={isRunning ? 'команда (op, say, stop, ...)' : 'Сервер не запущен'}
            value={cmd}
            disabled={!isRunning}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSendCommand(); }}
          />
          <button className="btn" onClick={onSendCommand} disabled={!isRunning || !cmd.trim()}>
            Отправить
          </button>
        </div>
      </div>

      {/* Settings */}
      <div className="card">
        <div className="card-head">
          <h2>Настройки</h2>
          {isRunning && (
            <span className="hint" style={{ fontSize: 11.5 }}>
              изменения применятся при следующем запуске
            </span>
          )}
        </div>
        <div className="server-settings-grid">
          <Field label="MOTD">
            <input
              className="input"
              value={server.properties.motd}
              onChange={(e) => onUpdate({ motd: e.target.value })}
            />
          </Field>
          <Field label="Порт">
            <input
              className="input"
              type="number"
              value={server.properties.serverPort}
              onChange={(e) => onUpdate({ serverPort: Math.max(1, Math.min(65535, parseInt(e.target.value, 10) || 25565)) })}
            />
          </Field>
          <Field label="Макс. игроков">
            <input
              className="input"
              type="number"
              value={server.properties.maxPlayers}
              onChange={(e) => onUpdate({ maxPlayers: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </Field>
          <Field label="Память (МБ)">
            <input
              className="input"
              type="number"
              value={server.memoryMb}
              onChange={(e) => onSetMemory(Math.max(512, parseInt(e.target.value, 10) || 1024))}
            />
          </Field>
          <Field label="Режим игры">
            <select
              className="input"
              value={server.properties.gamemode}
              onChange={(e) => onUpdate({ gamemode: e.target.value as ServerProperties['gamemode'] })}
            >
              <option value="survival">Выживание</option>
              <option value="creative">Творческий</option>
              <option value="adventure">Приключение</option>
              <option value="spectator">Наблюдатель</option>
            </select>
          </Field>
          <Field label="Сложность">
            <select
              className="input"
              value={server.properties.difficulty}
              onChange={(e) => onUpdate({ difficulty: e.target.value as ServerProperties['difficulty'] })}
            >
              <option value="peaceful">Мирная</option>
              <option value="easy">Лёгкая</option>
              <option value="normal">Нормальная</option>
              <option value="hard">Сложная</option>
            </select>
          </Field>
          <Field label="Защита спавна (блоки)">
            <input
              className="input"
              type="number"
              value={server.properties.spawnProtection}
              onChange={(e) => onUpdate({ spawnProtection: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            />
          </Field>
          <div className="server-toggles">
            <Toggle label="PvP" value={server.properties.pvp} onChange={(v) => onUpdate({ pvp: v })} />
            <Toggle label="Whitelist" value={server.properties.whiteList} onChange={(v) => onUpdate({ whiteList: v })} />
            <Toggle label="Online-mode" value={server.properties.onlineMode} onChange={(v) => onUpdate({ onlineMode: v })} />
          </div>
        </div>
        <div className="hint" style={{ marginTop: 14, fontSize: 12 }}>
          Изменили порт? Нажмите «Остановить» и «Запустить» снова — новые настройки применятся.
        </div>
      </div>
    </>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="server-field">
    <span className="server-field-label">{label}</span>
    {children}
  </label>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <label className="server-toggle">
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    <span>{label}</span>
  </label>
);

// ─── Create form (inline в боковой колонке) ─────────────────────────────────

const CreateServerForm: React.FC<{
  onCancel: () => void;
  onCreated: () => void;
}> = ({ onCancel, onCreated }) => {
  const [name, setName] = useState('');
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionId, setVersionId] = useState('');
  const [memoryMb, setMemoryMb] = useState(2048);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ServerCreateProgress | null>(null);

  useEffect(() => {
    window.api.minecraft.versions().then((list) => {
      // Берём только релизы — для них Mojang всегда отдаёт server.jar
      const releases = list.filter((v) => v.type === 'release');
      setVersions(releases);
      if (releases[0]) setVersionId(releases[0].id);
    });
    const off = window.api.servers.onCreateProgress(setProgress);
    return () => { off(); };
  }, []);

  const onCreate = async () => {
    if (!versionId) { setError('Выберите версию'); return; }
    setBusy(true);
    setError('');
    try {
      await window.api.servers.create({
        name: name.trim() || `Server-${versionId}`,
        versionId,
        memoryMb,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="card server-create-card">
      <div className="card-head">
        <h2>Новый сервер</h2>
      </div>
      <div className="server-create-body">
        <Field label="Название">
          <input
            className="input"
            autoFocus
            placeholder="Мой сервер"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Версия Minecraft">
          <select
            className="input"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
            disabled={busy}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.id}</option>
            ))}
          </select>
        </Field>
        <Field label="Память (МБ)">
          <input
            className="input"
            type="number"
            value={memoryMb}
            onChange={(e) => setMemoryMb(Math.max(512, parseInt(e.target.value, 10) || 1024))}
            disabled={busy}
          />
        </Field>
        <div className="hint" style={{ fontSize: 12 }}>
          Скачается server.jar c серверов Mojang (~30 МБ для современных версий)
          и сразу примется EULA.
        </div>
        {progress && (
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
        {error && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            <IconAlert /> {error}
          </div>
        )}
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Отмена</button>
          <button className="btn primary" onClick={onCreate} disabled={busy || !versionId}>
            {busy ? 'Создаём...' : 'Создать'}
          </button>
        </div>
      </div>
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
