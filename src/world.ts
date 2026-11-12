export const SCENE_WIDTH = 76;
export const SCENE_HEIGHT = 144;

export interface WorldInput {
  position: number;
  time: number;
  pointerX: number;
  pointerY: number;
  reducedMotion: boolean;
  /** Optional export clock: all ambient animation repeats over this duration. */
  loopDuration?: number;
}

export interface WorldFrame {
  color: Uint8Array;
  lit: Uint8Array;
  glow: Uint8Array;
}

type RGB = readonly [number, number, number];
type Keys = readonly [string, string, string, string];
interface Material {
  keys: readonly [RGB, RGB, RGB, RGB];
  emission: number;
}

const M = {
  sky: 0, outline: 1, snow: 2, snowShade: 3, rock: 4, farRock: 5,
  pine: 6, pineShade: 7, timber: 8, roof: 9, darkWindow: 10,
  lamp: 11, metal: 12, coral: 13, coralShade: 14, glass: 15,
  skin: 16, wool: 17, scarf: 18, cream: 19, ink: 20,
  sun: 21, star: 22, aurora: 23, violet: 24, flake: 25, flash: 26,
} as const;

const hex = (value: string): RGB => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];

const material = (keys: Keys, emission = 0): Material => ({
  keys: [hex(keys[0]), hex(keys[1]), hex(keys[2]), hex(keys[3])], emission,
});

// Every entry has four authored light keys. No world RGB colour interpolation occurs.
const materials: readonly Material[] = [
  material(['#b3d3d9', '#c8a4ad', '#596783', '#17233c']),
  material(['#354758', '#424151', '#293449', '#101b30']),
  material(['#edf1df', '#f0dfd4', '#bbcbd8', '#839db7']),
  material(['#abc8d3', '#c8b5c4', '#819bb6', '#486382']),
  material(['#769baa', '#a18b9f', '#617c9c', '#344c70']),
  material(['#93b5bf', '#b69eae', '#7188a5', '#405778']),
  material(['#47777a', '#666a7c', '#38546b', '#244154']),
  material(['#305c67', '#4d526a', '#2e435e', '#172e47']),
  material(['#af806d', '#bb8a79', '#765b69', '#4f4459']),
  material(['#65899d', '#897e96', '#526984', '#344963']),
  material(['#658697', '#6b7186', '#3b506e', '#233b58']),
  material(['#f1cd87', '#ffce8c', '#ffcc8a', '#ffd38c'], 204),
  material(['#839ea7', '#aaa0b0', '#7388a2', '#536e8a']),
  material(['#db8f68', '#e9a078', '#bc7e73', '#8f6673']),
  material(['#b56a58', '#c77b6e', '#8f5865', '#623f55']),
  material(['#b8d9d7', '#d2d6cf', '#8fbbca', '#668da7']),
  material(['#edc69b', '#f0c9a7', '#d6b2a0', '#b89d98']),
  material(['#6c97ad', '#8b9db3', '#5c7d9b', '#405d82']),
  material(['#dd8975', '#e9a08b', '#be7c87', '#946c88']),
  material(['#f3e8ce', '#fff0d5', '#d5d8ce', '#adb9bd']),
  material(['#2e3d4b', '#4b4050', '#283a52', '#14273f']),
  material(['#fff0bd', '#f8d19e', '#e1d9bf', '#dbe5d1'], 92),
  material(['#b3d3d9', '#c8a4ad', '#d1dce0', '#edf4e5'], 80),
  material(['#b3d3d9', '#c8a4ad', '#79aeaf', '#79d9ba'], 126),
  material(['#b3d3d9', '#c8a4ad', '#9e9ab6', '#a9a5dd'], 100),
  material(['#f7f7e7', '#fff0e3', '#d4e4e5', '#accddc']),
  material(['#fff4c4', '#fff4c4', '#fff4c4', '#fff4c4'], 255),
];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const SHADE = [1, 1.15, 0.76] as const;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export function createWorld(seed: number): { render(input: WorldInput): WorldFrame } {
  const size = SCENE_WIDTH * SCENE_HEIGHT;
  const color = new Uint8Array(size * 4);
  const lit = new Uint8Array(size * 4);
  const glow = new Uint8Array(size * 4);
  const ids = new Uint8Array(size);
  const shades = new Uint8Array(size);
  const mask = new Uint8Array(32 * 32);
  const palette = new Uint8Array(materials.length * 4 * 3 * 3);

  for (let id = 0; id < materials.length; id += 1) {
    const entry = materials[id];
    if (!entry) continue;
    for (let key = 0; key < 4; key += 1) {
      const rgb = entry.keys[key];
      if (!rgb) continue;
      for (let shade = 0; shade < 3; shade += 1) {
        const factor = SHADE[shade] ?? 1;
        for (let channel = 0; channel < 3; channel += 1) {
          palette[((id * 4 + key) * 3 + shade) * 3 + channel] = Math.round(clamp((rgb[channel] ?? 0) * factor, 0, 255));
        }
      }
    }
  }

  // Each particle is seeded once. Render order and frame history cannot change the scene.
  let state = seed >>> 0 || 0x92c7d53b;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const stars = Array.from({ length: 27 }, () => ({ x: 4 + random() * 68, y: 4 + random() * 62, phase: random() * 6.28 }));
  const snow = Array.from({ length: 28 }, () => ({ x: random() * 92, y: random() * 168, speed: 3 + random() * 7, phase: random() * 6.28 }));

  const pixel = (x: number, y: number, id: number, shade = 0): void => {
    const xx = Math.round(x), yy = Math.round(y);
    if (xx < 0 || xx >= SCENE_WIDTH || yy < 0 || yy >= SCENE_HEIGHT) return;
    const index = xx + yy * SCENE_WIDTH;
    ids[index] = id;
    shades[index] = shade;
  };
  const rect = (x: number, y: number, w: number, h: number, id: number, shade = 0): void => {
    const left = Math.max(0, Math.round(x)), top = Math.max(0, Math.round(y));
    const right = Math.min(SCENE_WIDTH, Math.round(x + w)), bottom = Math.min(SCENE_HEIGHT, Math.round(y + h));
    for (let yy = top; yy < bottom; yy += 1) for (let xx = left; xx < right; xx += 1) pixel(xx, yy, id, shade);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, id: number): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i += 1) {
      const f = steps ? i / steps : 0;
      pixel(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, id);
    }
  };
  const polygon = (points: readonly (readonly [number, number])[], id: number): void => {
    let minY = SCENE_HEIGHT, maxY = 0;
    for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(SCENE_HEIGHT - 1, Math.ceil(maxY)); y += 1) {
      const hits: number[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (!a || !b || (a[1] > y) === (b[1] > y)) continue;
        hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) rect(Math.ceil(hits[i] ?? 0), y, Math.floor(hits[i + 1] ?? 0) - Math.ceil(hits[i] ?? 0) + 1, 1, id);
    }
  };

  type StampPainter = (fill: (x: number, y: number, w: number, h: number, id: number) => void) => void;
  const stamp = (x: number, y: number, w: number, h: number, paint: StampPainter): void => {
    mask.fill(0);
    paint((xx, yy, ww, hh, id) => {
      for (let sy = Math.max(0, Math.round(yy)); sy < Math.min(h, Math.round(yy + hh)); sy += 1) {
        for (let sx = Math.max(0, Math.round(xx)); sx < Math.min(w, Math.round(xx + ww)); sx += 1) mask[sx + sy * 32] = id;
      }
    });
    // Outline is generated from the filled silhouette rather than hand-drawn per sprite.
    for (let yy = -1; yy <= h; yy += 1) for (let xx = -1; xx <= w; xx += 1) {
      const occupied = xx >= 0 && yy >= 0 && xx < w && yy < h && (mask[xx + yy * 32] ?? 0) !== 0;
      if (occupied) continue;
      const neighbor = (sx: number, sy: number): boolean => sx >= 0 && sy >= 0 && sx < w && sy < h && (mask[sx + sy * 32] ?? 0) !== 0;
      if (neighbor(xx - 1, yy) || neighbor(xx + 1, yy) || neighbor(xx, yy - 1) || neighbor(xx, yy + 1)) pixel(x + xx, y + yy, M.outline);
    }
    for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) {
      const id = mask[xx + yy * 32] ?? 0;
      if (!id) continue;
      const top = yy === 0 || (mask[xx + (yy - 1) * 32] ?? 0) === 0;
      const bottom = yy === h - 1 || (mask[xx + (yy + 1) * 32] ?? 0) === 0;
      pixel(x + xx, y + yy, id, top ? 1 : bottom ? 2 : 0);
    }
  };

  const pine = (x: number, y: number, tall: number): void => {
    stamp(x - 7, y - tall, 15, tall + 3, fill => {
      fill(7, tall - 1, 2, 4, M.timber);
      for (let level = 0; level < 4; level += 1) {
        const yy = level * (tall - 4) / 4, half = 2 + level * 1.5;
        fill(7 - half, yy + 2, half * 2 + 1, 4, level % 2 ? M.pineShade : M.pine);
        fill(6 - half, yy + 5, half * 2 + 3, 3, M.pine);
        fill(7 - half, yy + 2, half * 2 + 1, 1, M.snow);
      }
    });
  };

  const frame: WorldFrame = { color, lit, glow };
  return {
    render(input: WorldInput): WorldFrame {
      const position = clamp(input.position, 0, 1);
      const t = input.reducedMotion ? 0 : input.time;
      const duration = Number.isFinite(input.loopDuration) && (input.loopDuration ?? 0) > 0 ? input.loopDuration : undefined;
      const wrap = (value: number, period = 1): number => ((value % period) + period) % period;
      // Quantizing the normalized phase removes floating-point remainder differences
      // between a fixed export frame and that same frame one period later.
      const phase = duration ? wrap(Math.round(wrap(t, duration) / duration * 1e9) / 1e9) : 0;
      const angle = (radiansPerSecond: number): number => duration ? phase * Math.PI * 2 * Math.max(1, Math.round(radiansPerSecond * duration / (Math.PI * 2))) : t * radiansPerSecond;
      const cycle = (perSecond: number, offset = 0): number => duration ? wrap(phase * Math.max(1, Math.round(perSecond * duration)) + offset) : (t * perSecond + offset) % 1;
      const clock = (period: number): number => duration ? cycle(1 / period) * period : t % period;
      const px = input.reducedMotion ? 0 : clamp(input.pointerX, -1, 1);
      const py = input.reducedMotion ? 0 : clamp(input.pointerY, -1, 1);
      const farX = Math.round(px + Math.sin(angle(0.21)) * 0.45);
      const midX = Math.round(px * 2);
      const nearX = Math.round(px * 3);
      const driftY = Math.round(py * 0.75);
      ids.fill(M.sky); shades.fill(0);

      // 1. Sky: daylight sun gives way to a low winter moon and constellations.
      for (const star of stars) {
        if (position > 0.42 && Math.sin(angle(0.7) + star.phase) > -0.55) {
          pixel(star.x + farX, star.y + driftY, M.star);
          if (star.phase < 0.8) { pixel(star.x + farX - 1, star.y + driftY, M.star); pixel(star.x + farX, star.y + driftY - 1, M.star); }
        }
      }
      const sunX = 54 + farX - position * 3, sunY = 18 + driftY + Math.sin(position * Math.PI) * 3;
      stamp(sunX - 6, sunY - 6, 13, 13, fill => {
        fill(3, 0, 7, 13, M.sun); fill(1, 2, 11, 9, M.sun); fill(0, 4, 13, 5, M.sun);
      });
      if (position > 0.68) {
        // 2. Aurora: ordered pixels brighten and wave as the summit becomes audible.
        const amount = (position - 0.68) / 0.32;
        for (let x = 1; x < 76; x += 2) {
          const yy = 15 + Math.sin(x * 0.09 + angle(0.3)) * 5 + farX;
          for (let h = 0; h < 9; h += 1) if ((x + h) % 4 < amount * (4 - h * 0.24)) pixel(x, yy + h, h < 5 ? M.aurora : M.violet);
        }
      }

      // 3. Distant ridges: snow caps preserve a clear alpine silhouette at every key.
      polygon([[0, 84], [10 + farX, 61], [21 + farX, 79], [49 + farX, 36], [76, 84], [76, 118], [0, 118]], M.farRock);
      polygon([[25 + farX, 75], [49 + farX, 36], [69 + farX, 72], [53 + farX, 59], [47 + farX, 67], [40 + farX, 59]], M.snow);
      polygon([[49 + farX, 36], [69 + farX, 72], [53 + farX, 59], [47 + farX, 67], [45 + farX, 55]], M.snowShade);
      polygon([[0, 105], [17 + midX, 75], [36 + midX, 103], [54 + midX, 80], [76, 108], [76, 144], [0, 144]], M.rock);
      polygon([[3 + midX, 98], [17 + midX, 75], [32 + midX, 98], [21 + midX, 91], [17 + midX, 95], [13 + midX, 90]], M.snow);

      // 4. Midground forest and ledges: the cable corridor remains open for the resident.
      pine(7 + midX, 103, 23); pine(65 + midX, 97, 22); pine(57 + midX, 114, 18);
      polygon([[0, 122], [20, 119], [43, 107], [76, 98], [76, 144], [0, 144]], M.snowShade);
      polygon([[0, 134], [21, 127], [49, 119], [76, 113], [76, 144], [0, 144]], M.snow);
      if (position > 0.18 && position < 0.76) {
        const fall = cycle(0.35, duration ? 0.27 : 0);
        for (let i = 0; i < 4; i += 1) pixel(8 + midX + fall * 6 + i, 87 + i * 2 + fall * 17, M.flake);
      }

      // 5. Warm base camp: night turns on its windows and strengthens the chimney plume.
      const lampId = position > 0.38 ? M.lamp : M.darkWindow;
      stamp(4 + nearX, 109, 22, 24, fill => {
        fill(3, 10, 16, 13, M.timber);
        fill(2, 8, 18, 4, M.roof); fill(5, 5, 12, 4, M.roof); fill(8, 2, 6, 4, M.roof);
        fill(1, 8, 20, 2, M.snow); fill(4, 5, 14, 2, M.snow); fill(7, 2, 8, 2, M.snow);
        fill(15, 0, 3, 7, M.timber); fill(14, 0, 5, 1, M.snow);
        fill(5, 13, 4, 5, lampId); fill(13, 13, 4, 5, lampId); fill(10, 18, 4, 5, M.outline);
      });
      for (let i = 0; i < 4; i += 1) {
        const puff = cycle(0.25, i * 0.24 + (duration ? 0.17 : 0));
        if (puff > 0.1 && puff < 0.9) rect(20 + nearX + Math.sin(puff * 5) * 2, 106 - puff * (7 + position * 10), 2 + Math.round(puff), 2, M.flake);
      }
      // A rabbit emerges in the forest, then retreats when the lamps take over.
      if (position > 0.2 && position < 0.8) {
        const hop = Math.sin(angle(2.1)), rx = 51 + Math.cos(angle(0.6)) * 8 + nearX, ry = 132 - hop * hop * 3;
        stamp(rx, ry - 6, 9, 8, fill => { fill(0, 4, 6, 4, M.cream); fill(5, 2, 4, 5, M.cream); fill(5, 0, 1, 3, M.cream); fill(8, 0, 1, 3, M.cream); fill(7, 3, 1, 1, M.ink); });
      }

      // 6. Cable and pylons: the resident is carried vertically through the light keys.
      line(38, 5, 38, 132, M.outline); line(41, 6, 41, 132, M.metal);
      for (const y of [59, 97]) {
        line(33, y + 4, 29, y + 17, M.metal); rect(29, y, 18, 2, M.metal); rect(30, y - 1, 3, 4, M.outline); rect(43, y, 3, 4, M.outline);
      }
      const cy = Math.round(118 - position * 92);
      rect(37, cy - 16, 2, 8, M.metal); rect(34, cy - 17, 8, 2, M.outline); rect(35, cy - 18, 6, 1, M.snow);
      const headShift = position < 0.1 ? -1 : Math.round(Math.sin(angle(1.2)) * 0.5);
      const photoPhase = clock(4.4);
      const photo = position > 0.83 && photoPhase > 1 && photoPhase < 2.5;
      stamp(27, cy - 9, 23, 23, fill => {
        fill(1, 4, 21, 16, M.coralShade); fill(2, 3, 19, 16, M.coral);
        fill(1, 2, 21, 2, M.snow); fill(4, 0, 14, 2, M.snow);
        fill(4, 6, 15, 10, M.glass); fill(3, 6, 2, 10, M.metal); fill(19, 6, 1, 10, M.metal);
        fill(8 + headShift, 8, 6, 6, M.skin); fill(7 + headShift, 7, 8, 2, M.wool); fill(8 + headShift, 4, 6, 4, M.wool); fill(10 + headShift, 3, 2, 2, M.cream);
        const eyeH = position < 0.1 || clock(4.8) > 4.62 ? 1 : 2;
        fill(9 + headShift, 10, 1, eyeH, M.ink); fill(12 + headShift, 10, 1, eyeH, M.ink);
        fill(8, 14, 7, 3, M.cream); fill(8, 14, 7, 1, M.scarf); fill(14, 15, 2, 2, M.scarf);
        if (photo) {
          fill(8, 11, 8, 4, M.ink); fill(10, 10, 3, 2, M.ink); fill(11, 12, 3, 2, M.glass);
          if (photoPhase > 1.55 && photoPhase < 1.72) { fill(17, 8, 3, 1, M.flash); fill(18, 7, 1, 3, M.flash); }
        } else if (position > 0.45) {
          const handY = 11 + Math.round(Math.sin(angle(3)) * 2);
          fill(15, handY, 2, 5, M.skin); fill(17, handY - 1, 2, 2, M.skin);
        } else {
          const sip = Math.sin(Math.max(0, Math.sin(angle(1.5))) * Math.PI / 2);
          fill(15, 14 - Math.round(sip * 2), 3, 3, M.cream);
        }
        fill(2, 18, 19, 3, M.coral); fill(4, 21, 15, 1, M.outline); fill(4, 19, 3, 1, position > 0.55 ? M.lamp : M.cream); fill(17, 19, 3, 1, position > 0.55 ? M.lamp : M.cream);
      });
      if (position < 0.45) {
        const steam = cycle(0.7, duration ? 0.31 : 0);
        pixel(45, cy + 2 - steam * 5, M.cream);
      }

      // 7. Foreground: a mast responds to wind, and snow crosses the little journey.
      rect(69 + nearX, 115, 1, 18, M.metal);
      const flagLength = 3 + Math.round(position * 3);
      rect(70 + nearX, 116 + Math.round(Math.sin(angle(3)) * position), flagLength, 3, M.scarf);
      const visibleSnow = 9 + Math.round(position * 19);
      for (let i = 0; i < visibleSnow; i += 1) {
        const flake = snow[i]; if (!flake) continue;
        // Loop particles travel downward through an offscreen wrap. The sine term
        // changes speed gently; its derivative is always positive (1 ± 0.44).
        const travel = phase + 0.07 * (Math.sin(phase * Math.PI * 2 + flake.phase) - Math.sin(flake.phase));
        const x = duration ? wrap(flake.x + Math.sin(angle(0.45) + flake.phase) * (2 + position * 5), 92) - 8 : ((flake.x + t * (1 + position * 5) + Math.sin(t * 0.45 + flake.phase)) % 92) - 8;
        const y = duration ? wrap(flake.y + travel * 168, 168) - 12 : ((flake.y + t * flake.speed) % 168) - 12;
        // Do not hide the face inside the moving carriage.
        if (!(x > 29 && x < 48 && y > cy - 5 && y < cy + 8)) pixel(x, y, M.flake);
      }

      const light = position * 3;
      const lo = Math.min(3, Math.floor(light)), hi = Math.min(3, lo + 1), fraction = light - lo;
      for (let y = 0; y < SCENE_HEIGHT; y += 1) for (let x = 0; x < SCENE_WIDTH; x += 1) {
        const index = x + y * SCENE_WIDTH, id = ids[index] ?? 0, shade = shades[index] ?? 0;
        const threshold = ((BAYER[(x & 3) + (y & 3) * 4] ?? 0) + 0.5) / 16;
        const key = fraction > threshold ? hi : lo;
        const base = ((id * 4 + key) * 3 + shade) * 3, full = ((id * 4) * 3 + shade) * 3, out = index * 4;
        const emission = materials[id]?.emission ?? 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const value = palette[base + channel] ?? 0;
          color[out + channel] = value;
          lit[out + channel] = palette[full + channel] ?? 0;
          glow[out + channel] = Math.round(value * emission / 255);
        }
        color[out + 3] = 255; lit[out + 3] = 255; glow[out + 3] = emission;
      }
      return frame;
    },
  };
}
