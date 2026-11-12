import { createWorld } from '../src/world.ts';
import { createGlassRenderer } from '../src/glass.ts';
import { mediaFrame, LOOP_SECONDS, LOOP_FPS } from './media-timeline.ts';
import { composeMedia, layoutSize, type MediaVariant } from './media-layout.ts';

const FPS = 30, COUNT = LOOP_SECONDS * FPS, SEED = 0x6d2b79f5;
const source = document.createElement('canvas');
const glass = createGlassRenderer(source);
glass.resize(96 * 6, 176 * 6);
const world = createWorld(SEED);
const preview = document.querySelector<HTMLCanvasElement>('#preview')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const button = document.querySelector<HTMLButtonElement>('#export')!;
const keys = [[215, 229, 229], [217, 192, 177], [107, 121, 147], [27, 43, 63]];
function roomColor(position: number): number[] {
  const p = Math.max(0, Math.min(1, position)) * 3, lo = Math.min(2, Math.floor(p)), blend = p - lo;
  return keys[lo]!.map((value, channel) => (value + (keys[lo + 1]![channel]! - value) * blend) / 255);
}
function renderControl(position: number, time: number, stretch = 1, angle = 0): number[] {
  const room = roomColor(position);
  glass.draw(world.render({ position, time, pointerX: 0, pointerY: 0, reducedMotion: false, loopDuration: LOOP_SECONDS }), { position, stretch, angle, room, cursor: [0, 0, 0, 0] });
  return room;
}
function canvasFor(variant: MediaVariant): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); Object.assign(canvas, layoutSize(variant)); return canvas;
}
function compose(canvas: HTMLCanvasElement, variant: MediaVariant, index: number): void {
  const frame = mediaFrame(index * LOOP_FPS / FPS), room = renderControl(frame.position, frame.time, frame.stretch, frame.angle);
  composeMedia(canvas.getContext('2d')!, source, { variant, position: frame.position, time: frame.time, room });
}
const blob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('PNG encode failed')), 'image/png'));
async function save(kind: string, name: string, data: Blob | string): Promise<void> {
  const response = await fetch(`/api/media?kind=${kind}&name=${name}`, { method: 'POST', body: data });
  if (!response.ok) throw Error(await response.text());
}
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let total = 0; for (let i = 0; i < a.length; i += 4) total += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  return total / (a.length / 4 * 3);
}
Object.assign(preview, layoutSize('portrait')); compose(preview, 'portrait', 150);
status.textContent = '12 秒循环 · 30 fps · 真实 WebGL 玻璃画面。';
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const portrait = canvasFor('portrait'), square = canvasFor('square');
    for (let i = 0; i < COUNT; i += 1) {
      compose(portrait, 'portrait', i); compose(square, 'square', i);
      await Promise.all([save('portrait', `${String(i).padStart(4, '0')}.png`, await blob(portrait)), save('square', `${String(i).padStart(4, '0')}.png`, await blob(square))]);
      if (i % 15 === 0 || i === COUNT - 1) { status.textContent = `正在导出：${i + 1} / ${COUNT} 帧`; preview.getContext('2d')!.drawImage(portrait, 0, 0); }
    }
    const stills: { variant: MediaVariant; name: string; position: number; time: number }[] = [
      { variant: 'cover', name: 'cover-1080x1350.png', position: .95, time: 5.7 },
      { variant: 'cover', name: 'day-1080x1350.png', position: .1, time: .8 },
      { variant: 'detail', name: 'detail-1080x1080.png', position: .7, time: 2.9 },
    ];
    for (const still of stills) {
      const canvas = canvasFor(still.variant), room = renderControl(still.position, still.time);
      composeMedia(canvas.getContext('2d')!, source, { ...still, room }); await save('still', still.name, await blob(canvas));
    }
    const stageCanvases = [.1, .4, .7, .95].map((position, i) => {
      renderControl(position, [.8, 2.2, 2.9, 5.7][i]!);
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      canvas.getContext('2d')!.drawImage(source, 0, 0); return canvas;
    });
    const stages = canvasFor('stages'); composeMedia(stages.getContext('2d')!, source, { variant: 'stages', position: .95, time: 5.7, room: roomColor(.95), stageCanvases });
    await save('still', 'stages-1600x1000.png', await blob(stages));
    const sourceChecks: Record<string, unknown> = {};
    for (const variant of ['portrait', 'square'] as const) {
      const canvas = canvasFor(variant), ctx = canvas.getContext('2d')!;
      const indices = [COUNT - 3, COUNT - 2, COUNT - 1, 0, 1, 2, COUNT];
      const pixels: Uint8ClampedArray[] = [];
      for (const index of indices) {
        compose(canvas, variant, index); pixels.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        await save('checks', `${variant}-${String(index).padStart(4, '0')}.png`, await blob(canvas));
      }
      const differences = pixels.slice(1, 6).map((value, index) => difference(pixels[index]!, value));
      sourceChecks[variant] = { endpointDifference: difference(pixels[3]!, pixels[6]!), seamDifference: differences[2], neighborDifference: Math.max(...differences.filter((_, index) => index !== 2)), differences };
    }
    await save('report', 'source-check.json', JSON.stringify({ duration: LOOP_SECONDS, fps: FPS, frames: COUNT, renderer: glass.mode, sourceChecks }, null, 2));
    status.textContent = '导出完成：视频帧、四张配图与循环检查已保存。';
    document.body.dataset.complete = 'true';
    Object.assign(preview, layoutSize('portrait')); compose(preview, 'portrait', 150);
  } catch (error) { status.textContent = `导出失败：${String(error)}`; document.body.dataset.error = String(error); button.disabled = false; }
});
window.addEventListener('pagehide', () => glass.dispose(), { once: true });
