import React from 'react';
import { IconMinimize, IconMaximize, IconClose, IconSpark } from './icons';
import { UpdateIndicator } from './UpdateIndicator';

export const TitleBar: React.FC = () => {
  return (
    <div className="titlebar">
      <div className="brand">
        <span className="brand-mark"><IconSpark /></span>
        <span>Trel</span>
      </div>
      <div className="spacer" />
      <UpdateIndicator />
      <div className="win-controls">
        <button className="win-btn" onClick={() => window.api.window.minimize()} title="Свернуть">
          <IconMinimize />
        </button>
        <button className="win-btn" onClick={() => window.api.window.maximize()} title="Развернуть">
          <IconMaximize />
        </button>
        <button className="win-btn close" onClick={() => window.api.window.close()} title="Закрыть">
          <IconClose />
        </button>
      </div>
    </div>
  );
};
