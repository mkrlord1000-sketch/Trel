import * as fs from 'node:fs';
import * as path from 'node:path';
import { LauncherSettings, MinecraftAccount } from '../shared/types';

export class SettingsStore {
  private settingsFile: string;
  private accountsFile: string;

  constructor(private launcherDir: string) {
    this.settingsFile = path.join(launcherDir, 'settings.json');
    this.accountsFile = path.join(launcherDir, 'accounts.json');
  }

  loadSettings(): LauncherSettings {
    const defaults: LauncherSettings = {
      gameDir: path.join(this.launcherDir, 'minecraft'),
      memoryMb: 2048,
    };
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'));
        if (!raw || typeof raw !== 'object') return defaults;
        // Защищаемся от мусора в полях — берём дефолты только если значение
        // правильного типа.
        const out: LauncherSettings = { ...defaults };
        if (typeof raw.gameDir === 'string' && raw.gameDir.length > 0) out.gameDir = raw.gameDir;
        if (typeof raw.memoryMb === 'number' && raw.memoryMb >= 256) out.memoryMb = raw.memoryMb;
        if (typeof raw.javaPath === 'string') out.javaPath = raw.javaPath;
        if (typeof raw.lastVersionId === 'string') out.lastVersionId = raw.lastVersionId;
        return out;
      }
    } catch {}
    return defaults;
  }

  saveSettings(s: LauncherSettings): void {
    fs.writeFileSync(this.settingsFile, JSON.stringify(s, null, 2), 'utf-8');
  }

  loadAccounts(): MinecraftAccount[] {
    try {
      if (fs.existsSync(this.accountsFile)) {
        const raw = JSON.parse(fs.readFileSync(this.accountsFile, 'utf-8'));
        if (!Array.isArray(raw)) return [];
        // Фильтруем мусорные записи: должны быть string uuid и string name.
        return raw.filter((a): a is MinecraftAccount =>
          a && typeof a === 'object'
          && typeof a.uuid === 'string' && a.uuid.length > 0
          && typeof a.name === 'string' && a.name.length > 0
          && (a.type === 'offline' || a.type === undefined),
        );
      }
    } catch {}
    return [];
  }

  saveAccounts(accounts: MinecraftAccount[]): void {
    fs.writeFileSync(this.accountsFile, JSON.stringify(accounts, null, 2), 'utf-8');
  }
}
