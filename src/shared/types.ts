export interface MinecraftAccount {
  type: 'offline';
  name: string;
  uuid: string;
  /**
   * Кастомный скин в виде data-URL (PNG, 64×64 или 64×32 legacy).
   * Используется для отображения аватара/превью внутри лаунчера.
   * В offline-режиме сама игра свой скин в текстурах НЕ покажет —
   * для этого нужен либо мод-скин-лоадер, либо локальный yggdrasil-сервер.
   */
  skin?: string;
  /** Модель скина: classic (Steve, 4px руки) или slim (Alex, 3px руки). */
  skinModel?: 'classic' | 'slim';
}

export interface VersionInfo {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
  url: string;
}

export interface LaunchOptions {
  versionId: string;
  account: MinecraftAccount;
  memoryMb: number;
}

export interface LauncherSettings {
  gameDir: string;
  memoryMb: number;
  javaPath?: string;
  lastVersionId?: string;
}

export interface DownloadProgress {
  stage: string;
  current: number;
  total: number;
  percent: number;
}
