import React from 'react';
import type { Page } from '../App';
import type { MinecraftAccount } from '../../shared/types';
import { IconPlay, IconCube, IconCheck, IconUser, IconSettings, IconGlobe, IconArchive, IconSkin, IconServer } from './icons';
import { SkinFace } from './SkinPreview';

interface Props {
  page: Page;
  onChange: (p: Page) => void;
  activeAccount: MinecraftAccount | null;
}

interface NavItem {
  id: Page;
  label: string;
  Icon: React.FC<any>;
}

const PRIMARY: NavItem[] = [
  { id: 'home',      label: 'Главная',    Icon: IconPlay },
  { id: 'browse',    label: 'Каталог',    Icon: IconCube },
  { id: 'installed', label: 'Моё',        Icon: IconCheck },
  { id: 'worlds',    label: 'Миры',       Icon: IconGlobe },
  { id: 'content',   label: 'Контент',    Icon: IconArchive },
  { id: 'servers',   label: 'Серверы',    Icon: IconServer },
];
const SECONDARY: NavItem[] = [
  { id: 'accounts', label: 'Аккаунты',  Icon: IconUser },
  { id: 'skin',     label: 'Скин',      Icon: IconSkin },
  { id: 'settings', label: 'Настройки', Icon: IconSettings },
];

export const Sidebar: React.FC<Props> = ({ page, onChange, activeAccount }) => {
  const renderItem = (it: NavItem) => (
    <div
      key={it.id}
      className={'nav-item' + (page === it.id ? ' active' : '')}
      onClick={() => onChange(it.id)}
    >
      <it.Icon />
      <span>{it.label}</span>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="nav-group">{PRIMARY.map(renderItem)}</div>
      <div className="nav-divider" />
      <div className="nav-group">{SECONDARY.map(renderItem)}</div>

      <div className="spacer" />
      {activeAccount && (
        <div className="account-chip">
          <SkinFace
            skin={activeAccount.skin ?? null}
            size={32}
            fallbackName={activeAccount.name}
            className="avatar-sm"
          />
          <div className="info">
            <div className="name">{activeAccount.name}</div>
            <div className="role">Гость</div>
          </div>
        </div>
      )}
    </aside>
  );
};
