/**
 * Генератор пресет-скинов для Trel-лаунчера.
 *
 * Запуск: `npx ts-node scripts/generate-skins.ts` (или см. npm-скрипт `skins`).
 * Скины пишутся в `build/skins/<id>.png` как 64×64 PNG, и параллельно собирается
 * `src/renderer/data/skin-presets.ts` с инлайн-data-URL-ами и метаданными.
 *
 * Дизайн-направление: футуристика/киберпанк/тех — неоновые подсветки, броня,
 * визоры, акценты в тему лаунчера (фиолетовый/циан/магента).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';

// ─── Утилиты работы с холстом ────────────────────────────────────────────
type RGBA = [number, number, number, number];

const W = 64;
const H = 64;

class Canvas {
  data: Buffer;
  constructor() {
    this.data = Buffer.alloc(W * H * 4); // полностью прозрачный
  }
  px(x: number, y: number, c: RGBA) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
  /** Вертикальный градиент сверху→вниз внутри прямоугольника */
  vgrad(x: number, y: number, w: number, h: number, top: RGBA, bot: RGBA) {
    for (let yy = 0; yy < h; yy++) {
      const t = h === 1 ? 0 : yy / (h - 1);
      const c: RGBA = [
        Math.round(top[0] * (1 - t) + bot[0] * t),
        Math.round(top[1] * (1 - t) + bot[1] * t),
        Math.round(top[2] * (1 - t) + bot[2] * t),
        Math.round(top[3] * (1 - t) + bot[3] * t),
      ];
      for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, c);
    }
  }
  /**
   * Окрашивает пиксели только если они уже не прозрачные. Удобно «накрашивать»
   * детали поверх уже залитой области.
   */
  set(x: number, y: number, c: RGBA) {
    this.px(x, y, c);
  }
  toPng(): Buffer {
    const png = new PNG({ width: W, height: H });
    this.data.copy(png.data);
    return PNG.sync.write(png);
  }
}

// ─── UV-карта классического 64×64 скина Minecraft ────────────────────────
// Каждая «грань» — 4 строки/колонки наружу (top/bot/left/right/front/back),
// но для пресетов мы используем главные «лицевые» области.

interface BoxUV {
  /** Передняя грань (front) */
  front: { x: number; y: number; w: number; h: number };
  /** Задняя грань (back) */
  back: { x: number; y: number; w: number; h: number };
  /** Правый бок */
  right: { x: number; y: number; w: number; h: number };
  /** Левый бок */
  left: { x: number; y: number; w: number; h: number };
  /** Верх */
  top: { x: number; y: number; w: number; h: number };
  /** Низ */
  bottom: { x: number; y: number; w: number; h: number };
}

/** Вернёт UV-координаты бокса по его позиции «layout-стандарта». */
function box(ox: number, oy: number, w: number, h: number, d: number): BoxUV {
  return {
    top:    { x: ox + d,         y: oy,         w: w,  h: d },
    bottom: { x: ox + d + w,     y: oy,         w: w,  h: d },
    right:  { x: ox,             y: oy + d,     w: d,  h: h },
    front:  { x: ox + d,         y: oy + d,     w: w,  h: h },
    left:   { x: ox + d + w,     y: oy + d,     w: d,  h: h },
    back:   { x: ox + d + w + d, y: oy + d,     w: w,  h: h },
  };
}

// Базовые слои (head/body/right-arm/left-arm/right-leg/left-leg)
const HEAD = box(0, 0, 8, 8, 8);
const HEAD2 = box(32, 0, 8, 8, 8);
const BODY = box(16, 16, 8, 12, 4);
const BODY2 = box(16, 32, 8, 12, 4);
const RARM = box(40, 16, 4, 12, 4);
const RARM2 = box(40, 32, 4, 12, 4);
const LARM = box(32, 48, 4, 12, 4);
const LARM2 = box(48, 48, 4, 12, 4);
const RLEG = box(0, 16, 4, 12, 4);
const RLEG2 = box(0, 32, 4, 12, 4);
const LLEG = box(16, 48, 4, 12, 4);
const LLEG2 = box(0, 48, 4, 12, 4);

// Для удобства — рисует все 6 граней бокса одним цветом (с разной яркостью).
function paintBox(c: Canvas, b: BoxUV, base: RGBA, opts?: { topTint?: number; bottomTint?: number; sideTint?: number }) {
  const t = opts?.topTint ?? 1.15;
  const bt = opts?.bottomTint ?? 0.7;
  const st = opts?.sideTint ?? 0.92;
  const tint = (col: RGBA, k: number): RGBA => [
    Math.max(0, Math.min(255, Math.round(col[0] * k))),
    Math.max(0, Math.min(255, Math.round(col[1] * k))),
    Math.max(0, Math.min(255, Math.round(col[2] * k))),
    col[3],
  ];
  c.rect(b.front.x, b.front.y, b.front.w, b.front.h, base);
  c.rect(b.back.x, b.back.y, b.back.w, b.back.h, tint(base, st * 0.95));
  c.rect(b.right.x, b.right.y, b.right.w, b.right.h, tint(base, st));
  c.rect(b.left.x, b.left.y, b.left.w, b.left.h, tint(base, st));
  c.rect(b.top.x, b.top.y, b.top.w, b.top.h, tint(base, t));
  c.rect(b.bottom.x, b.bottom.y, b.bottom.w, b.bottom.h, tint(base, bt));
}

// ─── Палитры и хелперы ───────────────────────────────────────────────────
const C = {
  // Тема лаунчера
  accent: [139, 125, 255, 255] as RGBA,
  accentDeep: [80, 60, 200, 255] as RGBA,
  accentBright: [180, 170, 255, 255] as RGBA,

  cyan: [80, 230, 255, 255] as RGBA,
  magenta: [255, 80, 180, 255] as RGBA,
  lime: [120, 255, 130, 255] as RGBA,
  amber: [255, 180, 50, 255] as RGBA,
  red: [240, 70, 70, 255] as RGBA,

  // «Кожа» / нейтрали
  skinLight: [240, 220, 200, 255] as RGBA,
  skinMid: [220, 180, 150, 255] as RGBA,
  skinDark: [120, 80, 60, 255] as RGBA,

  // Металлы
  steel: [160, 170, 185, 255] as RGBA,
  steelDark: [70, 80, 95, 255] as RGBA,
  steelLight: [210, 220, 230, 255] as RGBA,
  black: [25, 25, 30, 255] as RGBA,
  white: [240, 240, 245, 255] as RGBA,

  // Волосы
  hairDark: [40, 30, 30, 255] as RGBA,
  hairBlonde: [220, 190, 110, 255] as RGBA,
  hairPink: [255, 130, 200, 255] as RGBA,
};

interface Preset {
  id: string;
  name: string;
  category: 'male' | 'female' | 'neutral';
  description: string;
  draw: (c: Canvas) => void;
}

// ─── Вспомогательные «строительные блоки» ─────────────────────────────────

/** Простое лицо: глаза + рот на front-грани головы. */
function drawSimpleFace(c: Canvas, eyes: RGBA, mouth: RGBA = C.skinDark) {
  const f = HEAD.front;
  // Глаза (по 1×1 на y=4)
  c.set(f.x + 2, f.y + 4, eyes);
  c.set(f.x + 5, f.y + 4, eyes);
  // Рот
  c.set(f.x + 3, f.y + 6, mouth);
  c.set(f.x + 4, f.y + 6, mouth);
}

/** Шлем-визор полного покрытия — горизонтальная щель глаз с подсветкой. */
function drawVisor(c: Canvas, glow: RGBA) {
  const f = HEAD.front;
  for (let x = 1; x < 7; x++) c.set(f.x + x, f.y + 4, glow);
  // Слабая подсветка ниже (рефлекс)
  const dim: RGBA = [glow[0] >> 1, glow[1] >> 1, glow[2] >> 1, glow[3]];
  for (let x = 2; x < 6; x++) c.set(f.x + x, f.y + 5, dim);
}

/** Полоса-акцент по передней грани body (от ворота до пояса) */
function drawChestStripe(c: Canvas, color: RGBA, width = 1) {
  const f = BODY.front;
  const cx = f.x + 4 - Math.floor(width / 2);
  for (let y = 1; y < f.h - 1; y++) {
    for (let dx = 0; dx < width; dx++) c.set(cx + dx, f.y + y, color);
  }
}

/** Светящийся ореол шлема (1px по верху front) */
function drawHeadlamp(c: Canvas, color: RGBA) {
  const f = HEAD.front;
  for (let x = 2; x < 6; x++) c.set(f.x + x, f.y + 1, color);
}

// ─── 9 пресетов ──────────────────────────────────────────────────────────

const presets: Preset[] = [
  // ════ MALE ════════════════════════════════════════════════════════════
  {
    id: 'm-cyber-soldier',
    name: 'Кибер-солдат',
    category: 'male',
    description: 'Тактическая броня с циан-визором и подсветкой нагрудника',
    draw(c) {
      // Голова: чёрный шлем
      paintBox(c, HEAD, C.steelDark);
      // Визор циан
      drawVisor(c, C.cyan);
      // Тонкая полоса-акцент сверху лба
      const f = HEAD.front;
      for (let x = 1; x < 7; x++) c.set(f.x + x, f.y + 2, [40, 50, 60, 255]);
      // Hat-слой: лёгкий светлый кант
      paintBox(c, HEAD2, [60, 70, 85, 80]);

      // Тело — тёмная броня с циан акцентами
      paintBox(c, BODY, C.steelDark);
      drawChestStripe(c, C.cyan, 1);
      // Плечевые «пластины» сверху front
      c.rect(BODY.front.x, BODY.front.y, 2, 2, [50, 60, 75, 255]);
      c.rect(BODY.front.x + 6, BODY.front.y, 2, 2, [50, 60, 75, 255]);
      // Ремень
      c.rect(BODY.front.x, BODY.front.y + 10, 8, 1, C.black);

      // Руки и ноги — серая броня
      paintBox(c, RARM, C.steelDark);
      paintBox(c, LARM, C.steelDark);
      // Подсветка-полоса по предплечью
      c.set(RARM.front.x + 1, RARM.front.y + 8, C.cyan);
      c.set(RARM.front.x + 2, RARM.front.y + 8, C.cyan);
      c.set(LARM.front.x + 1, LARM.front.y + 8, C.cyan);
      c.set(LARM.front.x + 2, LARM.front.y + 8, C.cyan);

      paintBox(c, RLEG, [50, 55, 65, 255]);
      paintBox(c, LLEG, [50, 55, 65, 255]);
      // Ботинки
      c.rect(RLEG.front.x, RLEG.front.y + 9, 4, 3, C.black);
      c.rect(LLEG.front.x, LLEG.front.y + 9, 4, 3, C.black);
    },
  },

  {
    id: 'm-techno-pilot',
    name: 'Техно-пилот',
    category: 'male',
    description: 'Лётный комбинезон с фиолетовой нашивкой и наушниками',
    draw(c) {
      // Голова — кожа + волосы
      paintBox(c, HEAD, C.skinLight);
      // Волосы — тёмные (на top + 2 ряда фронта)
      const f = HEAD.front;
      c.rect(HEAD.top.x, HEAD.top.y, HEAD.top.w, HEAD.top.h, C.hairDark);
      for (let x = 0; x < 8; x++) c.set(f.x + x, f.y + 0, C.hairDark);
      for (let x = 0; x < 8; x++) c.set(f.x + x, f.y + 1, C.hairDark);
      // Лицо
      drawSimpleFace(c, C.cyan);
      // Наушники (Hat-слой)
      const f2 = HEAD2.front;
      c.set(f2.x + 0, f2.y + 3, C.accent);
      c.set(f2.x + 0, f2.y + 4, C.accent);
      c.set(f2.x + 7, f2.y + 3, C.accent);
      c.set(f2.x + 7, f2.y + 4, C.accent);

      // Комбинезон
      paintBox(c, BODY, C.accentDeep);
      // Нашивка-молния
      drawChestStripe(c, C.accentBright, 1);
      // Воротник
      c.rect(BODY.front.x, BODY.front.y, 8, 1, C.accent);

      // Перчатки
      paintBox(c, RARM, C.accentDeep);
      paintBox(c, LARM, C.accentDeep);
      c.rect(RARM.front.x, RARM.front.y + 9, 4, 3, C.black);
      c.rect(LARM.front.x, LARM.front.y + 9, 4, 3, C.black);

      // Штаны
      paintBox(c, RLEG, [40, 30, 100, 255]);
      paintBox(c, LLEG, [40, 30, 100, 255]);
      // Сапоги
      c.rect(RLEG.front.x, RLEG.front.y + 9, 4, 3, C.steelDark);
      c.rect(LLEG.front.x, LLEG.front.y + 9, 4, 3, C.steelDark);
    },
  },

  {
    id: 'm-ranger',
    name: 'Рейнджер пустошей',
    category: 'male',
    description: 'Плащ, броня, янтарный визор',
    draw(c) {
      // Голова — капюшон
      paintBox(c, HEAD, [60, 50, 40, 255]);
      // Лицо в тени
      const f = HEAD.front;
      c.rect(f.x + 1, f.y + 3, 6, 3, [30, 25, 20, 255]);
      // Янтарные глаза
      c.set(f.x + 2, f.y + 4, C.amber);
      c.set(f.x + 5, f.y + 4, C.amber);
      // Шарф-маска на нижней половине
      c.rect(f.x + 1, f.y + 6, 6, 1, [100, 80, 60, 255]);

      // Hat — выступающий капюшон
      paintBox(c, HEAD2, [70, 55, 40, 200]);

      // Тело — броня поверх кожаной куртки
      paintBox(c, BODY, [80, 60, 40, 255]);
      // Нагрудник
      c.rect(BODY.front.x + 1, BODY.front.y + 1, 6, 5, [110, 90, 60, 255]);
      // Ремни
      c.rect(BODY.front.x, BODY.front.y + 7, 8, 1, [40, 30, 25, 255]);
      c.rect(BODY.front.x + 1, BODY.front.y + 8, 1, 4, [40, 30, 25, 255]);

      // Руки — кожа+перчатки
      paintBox(c, RARM, [80, 60, 40, 255]);
      paintBox(c, LARM, [80, 60, 40, 255]);
      c.rect(RARM.front.x, RARM.front.y + 8, 4, 4, [40, 30, 25, 255]);
      c.rect(LARM.front.x, LARM.front.y + 8, 4, 4, [40, 30, 25, 255]);

      // Ноги — пыльные штаны + сапоги
      paintBox(c, RLEG, [70, 60, 50, 255]);
      paintBox(c, LLEG, [70, 60, 50, 255]);
      c.rect(RLEG.front.x, RLEG.front.y + 8, 4, 4, [50, 35, 25, 255]);
      c.rect(LLEG.front.x, LLEG.front.y + 8, 4, 4, [50, 35, 25, 255]);
    },
  },

  // ════ FEMALE ══════════════════════════════════════════════════════════
  {
    id: 'f-neon-hacker',
    name: 'Неон-хакер',
    category: 'female',
    description: 'Розовые волосы, толстовка, киберпанк-граффити',
    draw(c) {
      // Голова — кожа
      paintBox(c, HEAD, C.skinLight);
      // Волосы — розовые (top + лоб + бакенбарды)
      c.rect(HEAD.top.x, HEAD.top.y, HEAD.top.w, HEAD.top.h, C.hairPink);
      const f = HEAD.front;
      for (let x = 0; x < 8; x++) c.set(f.x + x, f.y + 0, C.hairPink);
      for (let x = 0; x < 8; x++) c.set(f.x + x, f.y + 1, C.hairPink);
      c.set(f.x + 0, f.y + 2, C.hairPink);
      c.set(f.x + 7, f.y + 2, C.hairPink);
      // Длинные волосы по бокам и сзади (через side+back)
      c.rect(HEAD.right.x, HEAD.right.y, HEAD.right.w, HEAD.right.h, C.hairPink);
      c.rect(HEAD.left.x, HEAD.left.y, HEAD.left.w, HEAD.left.h, C.hairPink);
      c.rect(HEAD.back.x, HEAD.back.y, HEAD.back.w, HEAD.back.h, C.hairPink);
      // Hat-слой добавляет «прядки»
      paintBox(c, HEAD2, [255, 130, 200, 200]);

      // Глаза магента, рот
      c.set(f.x + 2, f.y + 4, C.magenta);
      c.set(f.x + 5, f.y + 4, C.magenta);
      c.set(f.x + 3, f.y + 6, [180, 80, 100, 255]);
      c.set(f.x + 4, f.y + 6, [180, 80, 100, 255]);

      // Толстовка — тёмный фиолет
      paintBox(c, BODY, [50, 40, 80, 255]);
      // Граффити-полоска
      drawChestStripe(c, C.magenta, 1);
      c.set(BODY.front.x + 2, BODY.front.y + 5, C.cyan);
      c.set(BODY.front.x + 5, BODY.front.y + 5, C.cyan);
      // Капюшон-ворот
      c.rect(BODY.front.x, BODY.front.y, 8, 1, [70, 55, 110, 255]);

      // Рукава
      paintBox(c, RARM, [50, 40, 80, 255]);
      paintBox(c, LARM, [50, 40, 80, 255]);
      // Манжеты циан
      c.rect(RARM.front.x, RARM.front.y + 9, 4, 1, C.cyan);
      c.rect(LARM.front.x, LARM.front.y + 9, 4, 1, C.cyan);
      // Кисти-кожа
      c.rect(RARM.front.x, RARM.front.y + 10, 4, 2, C.skinLight);
      c.rect(LARM.front.x, LARM.front.y + 10, 4, 2, C.skinLight);

      // Чулки/легинсы
      paintBox(c, RLEG, [30, 25, 50, 255]);
      paintBox(c, LLEG, [30, 25, 50, 255]);
      // Кеды
      c.rect(RLEG.front.x, RLEG.front.y + 10, 4, 2, C.magenta);
      c.rect(LLEG.front.x, LLEG.front.y + 10, 4, 2, C.magenta);
    },
  },

  {
    id: 'f-quantum-mage',
    name: 'Квантовый маг',
    category: 'female',
    description: 'Капюшон со звёздами, накидка, голограммы',
    draw(c) {
      // Голова — капюшон тёмно-фиолетовый
      paintBox(c, HEAD, [40, 30, 80, 255]);
      // Звёзды на top
      c.set(HEAD.top.x + 2, HEAD.top.y + 2, C.cyan);
      c.set(HEAD.top.x + 5, HEAD.top.y + 5, C.accentBright);
      c.set(HEAD.top.x + 6, HEAD.top.y + 1, [255, 255, 255, 255]);
      // Лицо — кожа
      const f = HEAD.front;
      c.rect(f.x + 1, f.y + 3, 6, 3, C.skinLight);
      // Глаза — циан с белком
      c.set(f.x + 2, f.y + 4, C.cyan);
      c.set(f.x + 5, f.y + 4, C.cyan);
      // Рот
      c.set(f.x + 3, f.y + 6, [180, 100, 120, 255]);
      c.set(f.x + 4, f.y + 6, [180, 100, 120, 255]);
      // Капюшон надвигающийся (Hat)
      paintBox(c, HEAD2, [60, 45, 110, 220]);
      // Звёзды на Hat front
      const f2 = HEAD2.front;
      c.set(f2.x + 1, f2.y + 1, C.accentBright);
      c.set(f2.x + 6, f2.y + 2, C.cyan);

      // Накидка
      paintBox(c, BODY, [50, 40, 100, 255]);
      // Звёздная пыль на front
      c.set(BODY.front.x + 2, BODY.front.y + 3, C.cyan);
      c.set(BODY.front.x + 5, BODY.front.y + 6, C.accentBright);
      c.set(BODY.front.x + 1, BODY.front.y + 8, [255, 255, 255, 255]);
      c.set(BODY.front.x + 6, BODY.front.y + 9, C.cyan);
      // Светящаяся брошь
      c.set(BODY.front.x + 3, BODY.front.y + 2, C.accent);
      c.set(BODY.front.x + 4, BODY.front.y + 2, C.accent);

      // Рукава расклешённые (виден циан-кант)
      paintBox(c, RARM, [60, 45, 110, 255]);
      paintBox(c, LARM, [60, 45, 110, 255]);
      c.rect(RARM.front.x, RARM.front.y + 8, 4, 2, C.cyan);
      c.rect(LARM.front.x, LARM.front.y + 8, 4, 2, C.cyan);
      // Кисти
      c.rect(RARM.front.x, RARM.front.y + 10, 4, 2, C.skinLight);
      c.rect(LARM.front.x, LARM.front.y + 10, 4, 2, C.skinLight);

      // Платье/штаны
      paintBox(c, RLEG, [40, 30, 80, 255]);
      paintBox(c, LLEG, [40, 30, 80, 255]);
      // Босоножки-сандалии
      c.rect(RLEG.front.x, RLEG.front.y + 11, 4, 1, C.accent);
      c.rect(LLEG.front.x, LLEG.front.y + 11, 4, 1, C.accent);
    },
  },

  {
    id: 'f-mecha-pilot',
    name: 'Меха-пилот',
    category: 'female',
    description: 'Облегающий технокостюм с магента-схемами',
    draw(c) {
      // Шлем — белый/сталь
      paintBox(c, HEAD, C.steelLight);
      // Визор — широкий магента
      const f = HEAD.front;
      for (let x = 1; x < 7; x++) c.set(f.x + x, f.y + 3, C.magenta);
      for (let x = 1; x < 7; x++) c.set(f.x + x, f.y + 4, C.magenta);
      // Антенна на Hat
      paintBox(c, HEAD2, [220, 230, 240, 80]);
      c.set(HEAD2.top.x + 4, HEAD2.top.y + 3, C.cyan);
      c.set(HEAD2.top.x + 4, HEAD2.top.y + 2, C.magenta);

      // Костюм — белый с магента-схемами
      paintBox(c, BODY, C.steelLight);
      // Схема на торсе
      drawChestStripe(c, C.magenta, 1);
      c.set(BODY.front.x + 2, BODY.front.y + 4, C.magenta);
      c.set(BODY.front.x + 5, BODY.front.y + 4, C.magenta);
      c.set(BODY.front.x + 2, BODY.front.y + 7, C.magenta);
      c.set(BODY.front.x + 5, BODY.front.y + 7, C.magenta);
      // Пояс
      c.rect(BODY.front.x, BODY.front.y + 10, 8, 1, C.steelDark);

      // Руки
      paintBox(c, RARM, C.steelLight);
      paintBox(c, LARM, C.steelLight);
      // Линия по руке
      for (let y = 1; y < 11; y++) c.set(RARM.front.x + 1, RARM.front.y + y, C.magenta);
      for (let y = 1; y < 11; y++) c.set(LARM.front.x + 2, LARM.front.y + y, C.magenta);
      // Кисти-перчатки
      c.rect(RARM.front.x, RARM.front.y + 11, 4, 1, C.magenta);
      c.rect(LARM.front.x, LARM.front.y + 11, 4, 1, C.magenta);

      // Ноги
      paintBox(c, RLEG, C.steelLight);
      paintBox(c, LLEG, C.steelLight);
      // Боковая полоска
      for (let y = 0; y < 12; y++) c.set(RLEG.front.x + 0, RLEG.front.y + y, C.magenta);
      for (let y = 0; y < 12; y++) c.set(LLEG.front.x + 3, LLEG.front.y + y, C.magenta);
      // Сапоги
      c.rect(RLEG.front.x, RLEG.front.y + 9, 4, 3, C.steelDark);
      c.rect(LLEG.front.x, LLEG.front.y + 9, 4, 3, C.steelDark);
    },
  },

  // ════ NEUTRAL ═════════════════════════════════════════════════════════
  {
    id: 'n-android',
    name: 'Андроид',
    category: 'neutral',
    description: 'Хромированный корпус с фиолетовой подсветкой',
    draw(c) {
      // Голова — хром
      paintBox(c, HEAD, C.steelLight);
      // «Швы» по середине
      const f = HEAD.front;
      for (let y = 0; y < 8; y++) c.set(f.x + 3, f.y + y, C.steelDark);
      for (let y = 0; y < 8; y++) c.set(f.x + 4, f.y + y, C.steelDark);
      // Фиолетовые «глаза» — две точки
      c.set(f.x + 2, f.y + 4, C.accent);
      c.set(f.x + 5, f.y + 4, C.accent);
      // Решётка-рот
      c.set(f.x + 2, f.y + 6, C.steelDark);
      c.set(f.x + 4, f.y + 6, C.steelDark);
      c.set(f.x + 5, f.y + 6, C.steelDark);
      // Hat — лёгкий блик
      paintBox(c, HEAD2, [230, 240, 250, 60]);

      // Тело — хром с подсветкой ядра
      paintBox(c, BODY, C.steel);
      // Ядро — светящийся круг 2×2
      c.rect(BODY.front.x + 3, BODY.front.y + 4, 2, 2, C.accentBright);
      // Гало вокруг ядра
      c.set(BODY.front.x + 2, BODY.front.y + 4, C.accent);
      c.set(BODY.front.x + 5, BODY.front.y + 4, C.accent);
      c.set(BODY.front.x + 2, BODY.front.y + 5, C.accent);
      c.set(BODY.front.x + 5, BODY.front.y + 5, C.accent);
      c.set(BODY.front.x + 3, BODY.front.y + 3, C.accent);
      c.set(BODY.front.x + 4, BODY.front.y + 3, C.accent);
      c.set(BODY.front.x + 3, BODY.front.y + 6, C.accent);
      c.set(BODY.front.x + 4, BODY.front.y + 6, C.accent);
      // Шейный шов
      c.rect(BODY.front.x, BODY.front.y, 8, 1, C.steelDark);

      // Руки
      paintBox(c, RARM, C.steel);
      paintBox(c, LARM, C.steel);
      // Сочленения
      c.rect(RARM.front.x, RARM.front.y + 5, 4, 1, C.steelDark);
      c.rect(LARM.front.x, LARM.front.y + 5, 4, 1, C.steelDark);
      // Подсветка ладоней
      c.rect(RARM.front.x + 1, RARM.front.y + 11, 2, 1, C.accent);
      c.rect(LARM.front.x + 1, LARM.front.y + 11, 2, 1, C.accent);

      // Ноги
      paintBox(c, RLEG, C.steel);
      paintBox(c, LLEG, C.steel);
      // Сочленения колен
      c.rect(RLEG.front.x, RLEG.front.y + 6, 4, 1, C.steelDark);
      c.rect(LLEG.front.x, LLEG.front.y + 6, 4, 1, C.steelDark);
    },
  },

  {
    id: 'n-void-traveler',
    name: 'Странник пустоты',
    category: 'neutral',
    description: 'Тёмный плащ с галактическими узорами',
    draw(c) {
      // Голова — тёмная маска
      paintBox(c, HEAD, [20, 20, 35, 255]);
      // Звёздное небо на лице
      const f = HEAD.front;
      c.set(f.x + 2, f.y + 2, [255, 255, 255, 255]);
      c.set(f.x + 5, f.y + 3, C.cyan);
      c.set(f.x + 1, f.y + 5, C.accentBright);
      c.set(f.x + 6, f.y + 6, [255, 255, 255, 255]);
      c.set(f.x + 3, f.y + 7, C.accent);
      // Глаза — две яркие точки
      c.set(f.x + 2, f.y + 4, C.accentBright);
      c.set(f.x + 5, f.y + 4, C.accentBright);
      // Hat — корона из «звёзд»
      const f2 = HEAD2.front;
      c.set(f2.x + 0, f2.y + 0, C.cyan);
      c.set(f2.x + 7, f2.y + 0, C.cyan);
      c.set(f2.x + 3, f2.y + 0, C.accentBright);
      c.set(f2.x + 4, f2.y + 0, C.accentBright);

      // Плащ — глубокий синий
      paintBox(c, BODY, [25, 25, 60, 255]);
      // Туманности
      c.set(BODY.front.x + 1, BODY.front.y + 2, C.accent);
      c.set(BODY.front.x + 2, BODY.front.y + 3, C.accentBright);
      c.set(BODY.front.x + 6, BODY.front.y + 5, C.cyan);
      c.set(BODY.front.x + 5, BODY.front.y + 6, [255, 255, 255, 255]);
      c.set(BODY.front.x + 1, BODY.front.y + 9, C.accent);
      c.set(BODY.front.x + 4, BODY.front.y + 10, C.cyan);
      c.set(BODY.front.x + 6, BODY.front.y + 8, [255, 255, 255, 255]);

      // Руки — продолжение плаща
      paintBox(c, RARM, [25, 25, 60, 255]);
      paintBox(c, LARM, [25, 25, 60, 255]);
      c.set(RARM.front.x + 1, RARM.front.y + 4, C.accentBright);
      c.set(LARM.front.x + 2, LARM.front.y + 7, C.cyan);
      // Кисти исчезают в пустоте — почти чёрные
      c.rect(RARM.front.x, RARM.front.y + 10, 4, 2, [10, 10, 25, 255]);
      c.rect(LARM.front.x, LARM.front.y + 10, 4, 2, [10, 10, 25, 255]);

      // Ноги
      paintBox(c, RLEG, [20, 20, 50, 255]);
      paintBox(c, LLEG, [20, 20, 50, 255]);
      c.set(RLEG.front.x + 1, RLEG.front.y + 5, C.accentBright);
      c.set(LLEG.front.x + 2, LLEG.front.y + 8, C.cyan);
    },
  },

  {
    id: 'n-circuit-ghost',
    name: 'Цифровой призрак',
    category: 'neutral',
    description: 'Полупрозрачный силуэт с лаймовыми схемами',
    draw(c) {
      // Голова — тёмный матрикс с лаймовыми схемами
      paintBox(c, HEAD, [15, 25, 20, 255]);
      const f = HEAD.front;
      // Сетка-«матрица»
      for (let y = 0; y < 8; y += 2) for (let x = 0; x < 8; x += 2) c.set(f.x + x, f.y + y, [30, 60, 40, 255]);
      // Глаза — лайм
      c.set(f.x + 2, f.y + 4, C.lime);
      c.set(f.x + 5, f.y + 4, C.lime);
      // Цифры/линии
      c.set(f.x + 1, f.y + 1, C.lime);
      c.set(f.x + 6, f.y + 6, C.lime);
      // Hat — лёгкое сияние
      paintBox(c, HEAD2, [50, 100, 70, 80]);

      // Тело — те же матричные схемы
      paintBox(c, BODY, [15, 25, 20, 255]);
      // Полоса-«ядро»
      drawChestStripe(c, C.lime, 1);
      // Decorate схемы
      c.set(BODY.front.x + 1, BODY.front.y + 2, C.lime);
      c.set(BODY.front.x + 6, BODY.front.y + 4, C.lime);
      c.set(BODY.front.x + 2, BODY.front.y + 8, C.lime);
      c.set(BODY.front.x + 5, BODY.front.y + 9, C.lime);
      // Горизонтальные «байты»
      for (let x = 1; x < 7; x++) c.set(BODY.front.x + x, BODY.front.y + 1, [30, 80, 50, 255]);
      for (let x = 1; x < 7; x++) c.set(BODY.front.x + x, BODY.front.y + 11, [30, 80, 50, 255]);

      // Руки — растворяющиеся (gradient → ниже более прозрачно через тёмный)
      paintBox(c, RARM, [15, 25, 20, 255]);
      paintBox(c, LARM, [15, 25, 20, 255]);
      // Полоски-схемы
      for (let y = 1; y < 11; y += 3) {
        c.set(RARM.front.x + 1, RARM.front.y + y, C.lime);
        c.set(LARM.front.x + 2, LARM.front.y + y, C.lime);
      }

      // Ноги
      paintBox(c, RLEG, [15, 25, 20, 255]);
      paintBox(c, LLEG, [15, 25, 20, 255]);
      // Линии тока вниз
      for (let y = 0; y < 12; y += 2) {
        c.set(RLEG.front.x + 1, RLEG.front.y + y, [30, 80, 50, 255]);
        c.set(LLEG.front.x + 2, LLEG.front.y + y, [30, 80, 50, 255]);
      }
    },
  },
];

// ─── Запись ───────────────────────────────────────────────────────────────

// При запуске через tsc --outDir scripts/.tmp __dirname будет указывать на .tmp,
// поэтому сначала ищем родительский корень с package.json.
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const repoRoot = findRepoRoot(__dirname);
const outDir = path.join(repoRoot, 'build', 'skins');
fs.mkdirSync(outDir, { recursive: true });

const tsLines: string[] = [
  '// AUTO-GENERATED. Не редактируй вручную — правь scripts/generate-skins.ts',
  'export interface SkinPreset {',
  '  id: string;',
  '  name: string;',
  '  category: \'male\' | \'female\' | \'neutral\';',
  '  description: string;',
  '  /** PNG-data-URL, готов к сохранению в accounts.json. */',
  '  dataUrl: string;',
  '  /** Какую модель скина рекомендуем для этого пресета. */',
  '  model: \'classic\' | \'slim\';',
  '}',
  '',
  'export const SKIN_PRESETS: SkinPreset[] = [',
];

for (const p of presets) {
  const c = new Canvas();
  p.draw(c);
  const buf = c.toPng();
  fs.writeFileSync(path.join(outDir, p.id + '.png'), buf);
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  tsLines.push('  {');
  tsLines.push(`    id: ${JSON.stringify(p.id)},`);
  tsLines.push(`    name: ${JSON.stringify(p.name)},`);
  tsLines.push(`    category: ${JSON.stringify(p.category)},`);
  tsLines.push(`    description: ${JSON.stringify(p.description)},`);
  tsLines.push(`    model: 'classic',`);
  tsLines.push(`    dataUrl: ${JSON.stringify(dataUrl)},`);
  tsLines.push('  },');
}
tsLines.push('];');

fs.writeFileSync(
  path.join(repoRoot, 'src', 'renderer', 'data', 'skin-presets.ts'),
  tsLines.join('\n') + '\n',
  'utf-8',
);

console.log(`✓ Generated ${presets.length} skins → build/skins/*.png`);
console.log(`✓ Generated src/renderer/data/skin-presets.ts`);
