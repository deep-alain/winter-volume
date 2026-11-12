import assert from 'node:assert/strict';
import { mediaFrame, LOOP_SECONDS, LOOP_FPS, LOOP_FRAMES } from '../tools/media-timeline.ts';

assert.equal(LOOP_SECONDS, 12);
assert.equal(LOOP_FPS, 60);
assert.equal(LOOP_FRAMES, 720);
assert.deepEqual(mediaFrame(0), mediaFrame(LOOP_FRAMES));
assert.deepEqual(mediaFrame(-1), mediaFrame(LOOP_FRAMES - 1));
assert.deepEqual(mediaFrame(NaN), mediaFrame(0));
assert.deepEqual(mediaFrame(268), mediaFrame(268 + 5 * LOOP_FRAMES));

const before = mediaFrame(719);
const first = mediaFrame(0);
const after = mediaFrame(1);
for (const key of ['position', 'stretch', 'angle'] as const) {
  // The seam is in a resting passage. There is no end-of-video impulse,
  // stretch reset, or exaggerated wobble change hidden by frame wrapping.
  assert.ok(Math.abs(first[key] - before[key]) < 1e-7, `${key} jumps at seam`);
  assert.ok(Math.abs(after[key] - first[key]) < 1e-7, `${key} jumps after seam`);
  assert.ok(Math.abs((after[key] - first[key]) - (first[key] - before[key])) < 1e-7, `${key} changes derivative at seam`);
}

const ascent = Array.from({ length: 145 }, (_, index) => mediaFrame(60 + index));
const descent = Array.from({ length: 193 }, (_, index) => mediaFrame(360 + index));
assert.equal(ascent[0]?.target, 0.1);
assert.equal(ascent.at(-1)?.target, 0.95);
assert.equal(descent[0]?.target, 0.95);
assert.equal(descent.at(-1)?.target, 0.1);
assert.ok(ascent.every((frame, index) => index === 0 || frame.position >= (ascent[index - 1]?.position ?? 0)));
assert.ok(descent.every((frame, index) => index === 0 || frame.position <= (descent[index - 1]?.position ?? 1)));
assert.ok(mediaFrame(4.5 * LOOP_FPS).position > 0.9499, 'summit hold allows the resident to pose');
assert.ok(ascent.at(-1)!.position > 0.948, '2.4-second ascent reaches the summit promptly');
assert.ok(Math.max(...ascent.map(frame => frame.stretch)) > 1.03, 'motion retains visible glass stretch');

const saved = mediaFrame(268);
const modified = mediaFrame(268);
modified.position = -1;
mediaFrame(3);
mediaFrame(690);
assert.deepEqual(mediaFrame(268), saved, 'export frames cannot mutate the cached timeline');
for (let index = 0; index < LOOP_FRAMES; index += 1) {
  const frame = mediaFrame(index);
  Object.values(frame).forEach(value => assert.ok(Number.isFinite(value)));
  assert.ok(frame.position >= 0.1 - 1e-9 && frame.position <= 0.95 + 1e-9);
  assert.ok(frame.stretch >= 1 && frame.stretch <= 1.25);
  assert.ok(Math.abs(frame.angle) <= 0.12);
}
console.log('PASS media timeline: exact period, smooth seam, brisk ascent, summit hold, deterministic seeks');
