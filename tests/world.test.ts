import assert from 'node:assert/strict';
import { createWorld, SCENE_HEIGHT, SCENE_WIDTH } from '../src/world.ts';
import type { WorldFrame, WorldInput } from '../src/world.ts';

const seed = 0x6d2b79f5;
const input: WorldInput = { position: 0.77, time: 8.3, pointerX: 0.7, pointerY: -0.6, reducedMotion: false };
const copy = (frame: WorldFrame): WorldFrame => ({
  color: frame.color.slice(), lit: frame.lit.slice(), glow: frame.glow.slice(),
});

// Export seeks must not depend on earlier frames or on an earlier engine instance.
const world = createWorld(seed);
const expected = copy(world.render(input));
for (let index = 0; index < 40; index += 1) {
  world.render({ ...input, position: (index % 11) / 10, time: index * 0.93, pointerX: -0.9 });
}
assert.deepEqual(world.render(input), expected);
assert.deepEqual(createWorld(seed).render(input), expected);
assert.notDeepEqual(createWorld(seed + 1).render(input), expected);

// Reduced motion suppresses both time animation and pointer parallax, while still seeking volume.
const still = copy(world.render({ ...input, reducedMotion: true }));
assert.deepEqual(world.render({ ...input, time: 191.4, pointerX: -1, pointerY: 1, reducedMotion: true }), still);
assert.notDeepEqual(world.render({ ...input, position: 0.12, reducedMotion: true }), still);
assert.deepEqual(world.render({ ...input, position: -5 }), createWorld(seed).render({ ...input, position: 0 }));
assert.deepEqual(world.render({ ...input, position: 5 }), createWorld(seed).render({ ...input, position: 1 }));

// CPU buffers stay fixed-size and opaque; the emissive texture is premultiplied.
const night = world.render({ ...input, position: 1 });
assert.equal(night.color.length, SCENE_WIDTH * SCENE_HEIGHT * 4);
assert.equal(night.lit.length, night.color.length);
assert.equal(night.glow.length, night.color.length);
let emissivePixels = 0;
for (let offset = 0; offset < night.color.length; offset += 4) {
  assert.equal(night.color[offset + 3], 255);
  assert.equal(night.lit[offset + 3], 255);
  const alpha = night.glow[offset + 3] ?? 0;
  if (alpha > 0) emissivePixels += 1;
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok((night.glow[offset + channel] ?? 0) <= alpha);
  }
}
assert.ok(emissivePixels > 20, 'night scene must contain emissive stars, lamps, or aurora');

// In the first light interval, bare sky pixels must choose one authored key using the Bayer cell.
// This catches accidental RGB interpolation or filtering before the glass shader receives the world.
const halfLight = world.render({ position: 1 / 6, time: 0, pointerX: 0, pointerY: 0, reducedMotion: true });
const day = [179, 211, 217];
const dusk = [200, 164, 173];
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let checkedSky = 0;
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    const offset = (x + y * SCENE_WIDTH) * 4;
    if (!day.every((value, channel) => halfLight.lit[offset + channel] === value)) continue;
    const threshold = ((bayer[(x & 3) + (y & 3) * 4] ?? 0) + 0.5) / 16;
    assert.deepEqual(Array.from(halfLight.color.slice(offset, offset + 3)), threshold < 0.5 ? dusk : day);
    checkedSky += 1;
  }
}
assert.ok(checkedSky > 200, 'test must sample enough unobstructed sky');

// Every ambient layer uses the optional export period, including particles and resident gestures.
const period = 10;
const changedPixels = (a: Uint8Array, b: Uint8Array): number => {
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed += 1;
  return changed;
};
for (const position of [0.1, 0.5, 0.95]) {
  const loopInput = { ...input, position, pointerX: 0.4, pointerY: -0.3, loopDuration: period };
  for (const time of [0, 1 / 60, 1.23, 4.9, 8.37, period - 1 / 60]) {
    const here = copy(world.render({ ...loopInput, time }));
    assert.deepEqual(world.render({ ...loopInput, time: time + period }), here, 'all world buffers repeat at the export period');
  }
  const start = copy(world.render({ ...loopInput, time: 0 })).color;
  const last = copy(world.render({ ...loopInput, time: period - 1 / 60 })).color;
  let maxOrdinaryStep = 0;
  for (let i = 1; i < 60; i += 1) {
    const t = i * period / 60;
    const before = copy(world.render({ ...loopInput, time: t - 1 / 60 })).color;
    const after = copy(world.render({ ...loopInput, time: t })).color;
    maxOrdinaryStep = Math.max(maxOrdinaryStep, changedPixels(before, after));
  }
  const seamChanges = changedPixels(last, start);
  assert.ok(seamChanges <= maxOrdinaryStep, `loop cut cannot jump more pixels than an ordinary frame (${position}: ${seamChanges}/${maxOrdinaryStep})`);
  assert.notDeepEqual(world.render({ ...loopInput, time: 1 }).color, start, 'loop mode must animate rather than freeze the world');
  const frozenLoop = copy(world.render({ ...loopInput, time: 0, reducedMotion: true }));
  assert.deepEqual(world.render({ ...loopInput, time: 7, reducedMotion: true }), frozenLoop);
}
assert.deepEqual(world.render({ ...input, loopDuration: NaN }), createWorld(seed).render(input), 'invalid export periods preserve the default clock');

console.log('PASS world: deterministic seeks, seeded variation, reduced motion, control bounds, RGBA/glow, discrete Bayer lighting, seamless ambient loop');
