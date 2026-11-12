/** Offline social compositions. The supplied control is the real WebGL render. */
export type MediaVariant = 'portrait' | 'square' | 'cover' | 'stages' | 'detail';

interface MediaInput {
  variant: MediaVariant;
  position: number;
  time: number;
  /** Normalized room RGB, in the same range as GlassFrame.room. */
  room: readonly number[];
  stageCanvases?: readonly HTMLCanvasElement[];
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export function layoutSize(variant: MediaVariant): { width: number; height: number } {
  return variant === 'stages'
    ? { width: 1600, height: 1000 }
    : variant === 'portrait' || variant === 'cover'
      ? { width: 1080, height: 1350 }
      : { width: 1080, height: 1080 };
}

function drawControl(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, centerX: number, top: number, scale: number): void {
  ctx.imageSmoothingEnabled = false;
  const width = 96 * scale, height = 176 * scale;
  ctx.drawImage(canvas, Math.round(centerX - width / 2), Math.round(top), width, height);
}

/** A thin dark keyline keeps white type readable while the room changes smoothly. */
function type(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, weight = 400, opacity = 1): void {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = 'rgba(13, 30, 43, .66)';
  ctx.lineWidth = size > 35 ? 2.4 : 1.5;
  ctx.fillStyle = '#f7faf9';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function volume(ctx: CanvasRenderingContext2D, x: number, y: number, position: number): void {
  type(ctx, `${Math.round(clamp(position) * 100)}%`, x, y, 46, 400);
  type(ctx, '音量', x, y + 48, 17, 400, .92);
}

export function composeMedia(ctx: CanvasRenderingContext2D, control: HTMLCanvasElement, input: MediaInput): void {
  const { width, height } = layoutSize(input.variant);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  const rgb = input.room.map(v => Math.round(clamp(v) * 255));
  ctx.fillStyle = input.variant === 'stages' ? '#25374a' : `rgb(${rgb[0] ?? 0} ${rgb[1] ?? 0} ${rgb[2] ?? 0})`;
  ctx.fillRect(0, 0, width, height);

  if (input.variant === 'stages') {
    const frames = input.stageCanvases?.length ? input.stageCanvases : [control];
    const count = Math.min(4, frames.length);
    const cell = width / count;
    type(ctx, '从山脚，到极光。', width / 2, 77, 37, 450);
    const labels = count === 4
      ? ['山脚 · 热饮', '松林 · 出发', '雪线 · 招手', '极光 · 留影']
      : count === 3 ? ['山脚 · 热饮', '雪线 · 招手', '极光 · 留影'] : ['冬日旅行'];
    for (let i = 0; i < count; i += 1) {
      const center = cell * (i + .5);
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(226, 239, 245, .025)';
        ctx.fillRect(Math.round(cell * i), 133, Math.round(cell), 745);
      }
      drawControl(ctx, frames[i]!, center, 142, 4);
      type(ctx, labels[i] ?? labels[0]!, center, 913, 25, 400);
    }
  } else if (input.variant === 'detail') {
    drawControl(ctx, control, width / 2, 22, 6);
    type(ctx, '玻璃里，住着一个冬天。', width / 2, 72, 25, 400);
  } else if (input.variant === 'cover') {
    type(ctx, '一段藏在音量里的冬天', width / 2, 81, 20, 400);
    type(ctx, '把声音，送进冬天。', width / 2, 148, 48, 450);
    drawControl(ctx, control, width / 2, 239, 5);
    volume(ctx, width / 2, 1212, input.position);
  } else if (input.variant === 'square') {
    type(ctx, '一段藏在音量里的冬天', width / 2, 92, 22, 400);
    drawControl(ctx, control, width / 2, 141, 4);
    volume(ctx, width / 2, 956, input.position);
  } else {
    type(ctx, '一段藏在音量里的冬天', width / 2, 145, 24, 400);
    drawControl(ctx, control, width / 2, 212, 5);
    volume(ctx, width / 2, 1190, input.position);
  }
  ctx.restore();
}
