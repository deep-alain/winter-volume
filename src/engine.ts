import { createWorld } from './world';
import { createMotion, demoAt, stepMotion, type MotionState } from './motion';
import { createGlassRenderer } from './glass';

interface Elements { canvas: HTMLCanvasElement; slider: HTMLInputElement; status: HTMLSpanElement; room: HTMLDivElement; value: HTMLOutputElement }
const SEED = 0x6d2b79f5;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const roomKeys = [[215, 229, 229], [217, 192, 177], [107, 121, 147], [27, 43, 63]];
function roomColor(position: number): number[] {
  const p = clamp(position) * 3, from = Math.min(2, Math.floor(p)), t = p - from;
  return roomKeys[from].map((v, i) => (v + (roomKeys[from + 1][i] - v) * t) / 255);
}
function hashPixels(pixels: Uint8Array): string { let h = 2166136261; for (const v of pixels) h = Math.imul(h ^ v, 16777619); return (h >>> 0).toString(16); }

export function mountEngine({ canvas, slider, status, room, value }: Elements) {
  const query = new URLSearchParams(location.search), controller = new AbortController(), { signal } = controller;
  const renderer = createGlassRenderer(canvas, query.get('fallback') === '1');
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)'), darkQuery = matchMedia('(prefers-color-scheme: dark)');
  let reduced = reducedQuery.matches || query.get('reduced') === '1';
  const requested = query.has('value') ? Number(query.get('value')) : NaN;
  const initial = Number.isFinite(requested) ? clamp(requested / 100) : darkQuery.matches ? 1 : .32;
  let demo = query.get('demo') === '1', target = demo ? demoAt(0).target : initial;
  let motion: MotionState = createMotion(target), world = createWorld(SEED), time = 0, last = 0, raf = 0, disposed = false, seeking = false;
  let dragging = false, pointerId = -1, moved = false, startX = 0, startY = 0, pointerX = 0, pointerY = 0, lastAnnounced = -1;
  canvas.dataset.renderer = renderer.mode; canvas.dataset.sceneSize = '76x144';
  const resize = () => {
    const dpr = Math.max(1, window.devicePixelRatio || 1), height = Math.min(422, window.innerHeight - 210), width = Math.min(230, window.innerWidth * .64);
    const pixels = Math.max(1, Math.floor(Math.min(height * dpr / 176, width * dpr / 96)));
    const w = 96 * pixels, h = 176 * pixels;
    canvas.style.width = `${w / dpr}px`; canvas.style.height = `${h / dpr}px`;
    const frame = canvas.parentElement;
    if (frame) { frame.style.width = `${w / dpr}px`; frame.style.height = `${h / dpr}px`; }
    renderer.resize(w, h); canvas.dataset.sceneScale = String(pixels); canvas.dataset.dpr = String(dpr);
  };
  resize();
  function updateValue(announce: boolean) {
    const v = Math.round(target * 100); slider.value = String(v); slider.setAttribute('aria-valuetext', `${v}%，${v < 20 ? '山脚休息' : v < 55 ? '穿过松林' : v < 85 ? '雪线旅行' : '极光留影'}`);
    value.value = `${v}%`;
    if (announce && v !== lastAnnounced) { status.textContent = `音量 ${v}%`; lastAnnounced = v; }
  }
  function draw(cursor: readonly [number, number, number, number] = [0, 0, 0, 0]) {
    const frozen = reduced ? 0 : time;
    const frame = world.render({ position: motion.x, time: frozen, pointerX: reduced ? 0 : pointerX, pointerY: reduced ? 0 : pointerY, reducedMotion: reduced });
    const color = roomColor(motion.x);
    room.style.setProperty('--room-color', `rgb(${color.map(v => Math.round(v * 255)).join(' ')})`);
    const luminance = color.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ink = luminance < .183 ? '#ffffff' : '#000000';
    room.style.setProperty('--room-ink', ink); room.style.setProperty('--room-muted', ink);
    renderer.draw(frame, { position: motion.x, stretch: motion.stretch, angle: motion.angle, room: color, cursor });
    canvas.dataset.position = motion.x.toFixed(5); canvas.dataset.frame = Math.floor(time * 60).toString(); canvas.dataset.demo = String(demo);
    if (seeking || reduced) canvas.dataset.sceneHash = hashPixels(frame.color);
  }
  function tick(now: number) {
    raf = 0; if (disposed || seeking) return;
    const dt = Math.min(.05, Math.max(0, (now - (last || now)) / 1000)); last = now;
    if (!reduced) time += dt;
    const script = demo && !reduced ? demoAt(time) : null;
    if (script) { target = script.target; updateValue(false); }
    stepMotion(motion, target, dt, script?.pressed ?? dragging, reduced);
    draw(script ? [script.cursorX, script.cursorY, 1, Number(script.pressed)] : [0, 0, 0, 0]);
    raf = requestAnimationFrame(tick);
  }
  function handover() { demo = false; if (seeking) { seeking = false; last = 0; raf = requestAnimationFrame(tick); } }
  function atPointer(event: PointerEvent) {
    const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) / r.width * 96, y: (event.clientY - r.top) / r.height * 176 };
  }
  const change = (v: number, announce = false) => { target = clamp(v); if (reduced) stepMotion(motion, target, 0, false, true); updateValue(announce); if (reduced) draw(); };
  slider.addEventListener('pointerdown', event => {
    handover(); pointerId = event.pointerId; startX = event.clientX; startY = event.clientY; moved = false; dragging = true;
    slider.focus({ preventScroll: true }); slider.setPointerCapture(pointerId); event.preventDefault();
    const p = atPointer(event); change((134 - p.y) / 92);
  }, { signal });
  slider.addEventListener('pointermove', event => {
    const p = atPointer(event); pointerX = Math.max(-1, Math.min(1, (p.x - 48) / 48)); pointerY = Math.max(-1, Math.min(1, (p.y - 88) / 88));
    if (event.pointerId !== pointerId || !dragging) return;
    moved ||= Math.hypot(event.clientX - startX, event.clientY - startY) > 4;
    if (moved) { event.preventDefault(); change((134 - p.y) / 92); }
  }, { signal });
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return; dragging = false; pointerId = -1; updateValue(true);
    if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
  };
  slider.addEventListener('pointerup', release, { signal }); slider.addEventListener('pointercancel', release, { signal });
  slider.addEventListener('lostpointercapture', () => { dragging = false; pointerId = -1; }, { signal });
  slider.addEventListener('pointerleave', () => { if (!dragging) { pointerX = 0; pointerY = 0; } }, { signal });
  slider.addEventListener('input', () => { handover(); change(Number(slider.value) / 100, true); }, { signal });
  slider.addEventListener('keydown', event => {
    const step = event.shiftKey ? .1 : .02;
    const keys: Record<string, number> = { ArrowUp: target + step, ArrowRight: target + step, ArrowDown: target - step, ArrowLeft: target - step, Home: 0, End: 1, Enter: target < .5 ? 1 : 0, ' ': target < .5 ? 1 : 0 };
    if (!(event.key in keys)) return; event.preventDefault(); handover(); change(keys[event.key], true);
  }, { signal });
  // Any real pointer/key takes the scripted pointer out of the scene immediately.
  window.addEventListener('pointerdown', handover, { signal }); window.addEventListener('keydown', handover, { signal });
  window.addEventListener('resize', resize, { signal });
  reducedQuery.addEventListener('change', () => { reduced = reducedQuery.matches || query.get('reduced') === '1'; if (reduced) { stepMotion(motion, target, 0, false, true); draw(); } }, { signal });
  updateValue(true); draw(); raf = requestAnimationFrame(tick);

  const renderAt = (seconds: number) => {
    if (disposed) return;
    seeking = true; cancelAnimationFrame(raf); raf = 0;
    world = createWorld(SEED); motion = createMotion(demoAt(0).target); target = motion.x; pointerX = 0; pointerY = 0;
    const frameCount = Math.max(0, Math.floor(Math.min(120, Number.isFinite(seconds) ? seconds : 0) * 60));
    for (let i = 1; i <= frameCount; i++) { const frame = demoAt(i / 60); target = frame.target; stepMotion(motion, target, 1 / 60, frame.pressed, reduced); }
    time = frameCount / 60; const frame = demoAt(time); updateValue(true);
    draw(reduced ? [0, 0, 0, 0] : [frame.cursorX, frame.cursorY, 1, Number(frame.pressed)]);
  };
  const seek = query.get('t'); if (seek !== null) renderAt(Number(seek));
  return {
    renderAt,
    dispose() { if (disposed) return; disposed = true; cancelAnimationFrame(raf); raf = 0; controller.abort(); renderer.dispose(); },
  };
}
