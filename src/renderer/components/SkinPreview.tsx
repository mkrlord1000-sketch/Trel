import React, { useEffect, useRef } from 'react';

interface FaceProps {
  /** PNG data-URL скина или null. Если null — рисуется placeholder. */
  skin: string | null;
  /** Размер аватара в css-пикселях. Каждый пиксель скина увеличивается до size/8. */
  size?: number;
  /** Имя для placeholder-инициала, если скин не загружен. */
  fallbackName?: string;
  /** Дополнительный класс. */
  className?: string;
}

/**
 * Рисует ЛИЦО игрока (8×8 пикселей с базового слоя + 8×8 шапки) на canvas.
 * Совместим с современным форматом 64×64 и legacy 64×32.
 *
 * Используется в шапке/сайдбаре/карточке аккаунта вместо буквы-инициала.
 */
export const SkinFace: React.FC<FaceProps> = ({ skin, size = 32, fallbackName = '?', className }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !skin) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // Каждый пиксель скина = px css-пикселей.
      const px = size / 8;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      // База лица: src (8,8) → (16,16)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
      // Слой шапки/Hat: src (40,8) → (48,16)
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
    };
    img.src = skin;
  }, [skin, size]);

  if (!skin) {
    // Fallback: цветной квадрат с первой буквой имени.
    return (
      <div
        className={'skin-face-fallback ' + (className ?? '')}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      >
        {fallbackName.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={'skin-face ' + (className ?? '')}
      style={{ width: size, height: size }}
    />
  );
};

interface BodyProps {
  skin: string;
  /** Стиль модели: 4-пиксельные руки (Steve) или 3-пиксельные (Alex). */
  model?: 'classic' | 'slim';
  /** Высота превью в css-пикселях; ширина рассчитывается пропорционально. */
  height?: number;
  className?: string;
}

/**
 * Рисует 2D-разворот персонажа в полный рост (вид спереди):
 * голова + тело + руки + ноги, со вторыми слоями. 16×32 «скиновых» пикселей
 * соответствуют размеру кадра: высота 32 → ширина 16.
 */
export const SkinBody: React.FC<BodyProps> = ({ skin, model = 'classic', height = 192, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const armW = model === 'slim' ? 3 : 4;
  // Кадр: 16 «скиновых» пикселей в ширину. Высота 32. Соотношение 1:2.
  const w = (height * 16) / 32;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, height);
      const px = height / 32;

      // Все координаты — в пикселях скина (UV).
      // Базовые слои:
      // Голова   src (8,8)  8×8     → dst (4,0) 8×8
      // Тело     src (20,20) 8×12   → dst (4,8) 8×12
      // Правая рука  src (44,20) 4×12 → dst (12,8) armW×12
      // Левая рука   (mirror or 64×64)
      // Правая нога  src (4,20) 4×12 → dst (4,20) 4×12
      // Левая нога   (mirror or 64×64)

      const draw = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
        ctx.drawImage(img, sx, sy, sw, sh, dx * px, dy * px, dw * px, dh * px);
      };

      const drawMirror = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
        // Зеркалим горизонтально через временный canvas
        const tmp = document.createElement('canvas');
        tmp.width = sw;
        tmp.height = sh;
        const tctx = tmp.getContext('2d')!;
        tctx.imageSmoothingEnabled = false;
        tctx.translate(sw, 0);
        tctx.scale(-1, 1);
        tctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.drawImage(tmp, 0, 0, sw, sh, dx * px, dy * px, dw * px, dh * px);
      };

      const is64x64 = img.height >= 64;

      // === Голова ===
      draw(8, 8, 8, 8, 4, 0, 8, 8);
      draw(40, 8, 8, 8, 4, 0, 8, 8); // hat

      // === Тело ===
      draw(20, 20, 8, 12, 4, 8, 8, 12);
      if (is64x64) draw(20, 36, 8, 12, 4, 8, 8, 12); // body 2nd layer

      // === Правая рука (с точки зрения игрока — наша левая на экране) ===
      draw(44, 20, armW, 12, 12, 8, armW, 12);
      if (is64x64) draw(44, 36, armW, 12, 12, 8, armW, 12); // 2nd layer

      // === Левая рука ===
      if (is64x64) {
        // 64×64: отдельная UV (36,52)
        draw(36, 52, armW, 12, 4 - armW, 8, armW, 12);
        draw(52, 52, armW, 12, 4 - armW, 8, armW, 12); // 2nd layer
      } else {
        // 64×32 legacy: зеркалим правую
        drawMirror(44, 20, armW, 12, 4 - armW, 8, armW, 12);
      }

      // === Правая нога ===
      draw(4, 20, 4, 12, 8, 20, 4, 12);
      if (is64x64) draw(4, 36, 4, 12, 8, 20, 4, 12); // 2nd layer

      // === Левая нога ===
      if (is64x64) {
        draw(20, 52, 4, 12, 4, 20, 4, 12);
        draw(4, 52, 4, 12, 4, 20, 4, 12); // 2nd layer
      } else {
        drawMirror(4, 20, 4, 12, 4, 20, 4, 12);
      }
    };
    img.src = skin;
  }, [skin, model, w, height]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={height}
      className={'skin-body ' + (className ?? '')}
      style={{ width: w, height }}
    />
  );
};
