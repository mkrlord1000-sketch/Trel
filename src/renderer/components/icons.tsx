import React from 'react';

type P = React.SVGProps<SVGSVGElement>;

const base: P = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const IconPlay: React.FC<P> = (p) => (
  <svg {...base} {...p}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" /></svg>
);
export const IconCube: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
export const IconUser: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
export const IconSettings: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
export const IconSearch: React.FC<P> = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
export const IconTrash: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
export const IconRefresh: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
  </svg>
);
export const IconFolder: React.FC<P> = (p) => (
  <svg {...base} {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
);
export const IconInfo: React.FC<P> = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
);
export const IconAlert: React.FC<P> = (p) => (
  <svg {...base} {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
export const IconCheck: React.FC<P> = (p) => (
  <svg {...base} {...p}><polyline points="20 6 9 17 4 12" /></svg>
);
export const IconArrow: React.FC<P> = (p) => (
  <svg {...base} {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
);
export const IconMinimize: React.FC<P> = (p) => (
  <svg {...base} {...p}><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const IconMaximize: React.FC<P> = (p) => (
  <svg {...base} {...p}><rect x="4" y="4" width="16" height="16" rx="1" /></svg>
);
export const IconClose: React.FC<P> = (p) => (
  <svg {...base} {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" /></svg>
);
export const IconSpark: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12" />
  </svg>
);
export const IconArchive: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);
export const IconGlobe: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z" />
  </svg>
);

/**
 * Иконка «Скин» — стилизованный персонаж в стиле Minecraft (квадратные пропорции).
 * Голова, тело, руки, ноги — собраны из прямоугольников, без сглаживания.
 */
export const IconSkin: React.FC<P> = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...p}>
    {/* Голова */}
    <rect x="8" y="2" width="8" height="6" rx="0.5" />
    {/* Тело */}
    <rect x="9" y="9" width="6" height="7" rx="0.5" />
    {/* Левая рука */}
    <rect x="5" y="9" width="3" height="6" rx="0.5" />
    {/* Правая рука */}
    <rect x="16" y="9" width="3" height="6" rx="0.5" />
    {/* Левая нога */}
    <rect x="9" y="17" width="2.5" height="5" rx="0.5" />
    {/* Правая нога */}
    <rect x="12.5" y="17" width="2.5" height="5" rx="0.5" />
  </svg>
);

/**
 * Иконка «Скин не поддерживается» — стилизованный персонаж с диагональной чертой.
 * Показывается у pre-1.6 версий, где authlib-injector неприменим.
 */
export const IconSkinOff: React.FC<P> = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...p}>
    <rect x="8" y="2" width="8" height="6" rx="0.5" />
    <rect x="9" y="9" width="6" height="7" rx="0.5" />
    <rect x="5" y="9" width="3" height="6" rx="0.5" />
    <rect x="16" y="9" width="3" height="6" rx="0.5" />
    <rect x="9" y="17" width="2.5" height="5" rx="0.5" />
    <rect x="12.5" y="17" width="2.5" height="5" rx="0.5" />
    {/* Перечёркивающая линия */}
    <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Иконка «Сервер» — стилизованный rack-сервер с двумя секциями и индикатором.
 */
export const IconServer: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <line x1="6.5" y1="7.5" x2="6.5" y2="7.5" strokeWidth="2.4" />
    <line x1="6.5" y1="16.5" x2="6.5" y2="16.5" strokeWidth="2.4" />
    <line x1="10" y1="7.5" x2="17" y2="7.5" />
    <line x1="10" y1="16.5" x2="17" y2="16.5" />
  </svg>
);

/**
 * Иконка «Стоп» — квадратная заливка для кнопки остановки сервера.
 */
export const IconStop: React.FC<P> = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
);

/**
 * Иконка «Терминал» — для секции консоли сервера.
 */
export const IconTerminal: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const IconPlus: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Иконка «Скопировать» — две перекрывающиеся карточки. Используется на кнопках
 * «Скопировать адрес сервера», ник, и т.п.
 */
export const IconCopy: React.FC<P> = (p) => (
  <svg {...base} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
