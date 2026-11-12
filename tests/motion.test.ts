import assert from 'node:assert/strict';
import {
  createMotion,
  stepMotion,
  demoAt,
  DEMO_PERIOD,
} from '../src/motion.ts';

const near = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

// Equal elapsed time produces the same primary spring position at common frame rates.
const positions = [24, 30, 60, 120].map((hz) => {
  const state = createMotion(0.1);
  for (let frame = 0; frame < hz; frame += 1) stepMotion(state, 0.95, 1 / hz, false, false);
  return state.x;
});
positions.forEach((x) => near(x, positions[0] ?? 0));

// Dragging is tighter without teleporting or becoming unstable.
const loose = createMotion(0.1);
const tight = createMotion(0.1);
stepMotion(loose, 0.9, 1 / 60, false, false);
stepMotion(tight, 0.9, 1 / 60, true, false);
assert.ok(tight.x > loose.x && tight.x < 0.9);

// Sudden reversals and stalled frames keep the knob bounded; it eventually rests.
const state = createMotion(0.1);
for (let frame = 0; frame < 900; frame += 1) {
  const target = frame < 40 ? 1 : frame < 70 ? 0 : frame < 130 ? 1 : 0.63;
  stepMotion(state, target, frame % 11 === 0 ? 0.15 : 1 / 60, frame < 130, false);
  Object.values(state).forEach((value) => assert.ok(Number.isFinite(value)));
  assert.ok(state.x >= 0 && state.x <= 1);
  assert.ok(state.stretch >= 1 && state.stretch <= 1.25);
  assert.ok(Math.abs(state.angle) <= 0.12);
  near(state.stretch * (1 / state.stretch), 1);
}
near(state.x, 0.63);
near(state.v, 0);
assert.ok(Math.abs(state.angle) < 0.00001 && Math.abs(state.stretch - 1) < 0.00001);

// Reduced motion seeks immediately and holds all secondary movement still.
state.v = 8;
state.angle = 0.1;
state.angularVelocity = 2;
state.stretch = 1.2;
stepMotion(state, 0.42, 1 / 60, true, true);
assert.deepEqual(state, createMotion(0.42));

// The pointer always meets the vertical knob while pressed and wraps continuously.
for (let frame = 0; frame <= DEMO_PERIOD * 120; frame += 1) {
  const demo = demoAt(frame / 120);
  assert.ok(demo.target >= 0 && demo.target <= 1);
  assert.ok(demo.cursorX >= 0 && demo.cursorX <= 96);
  assert.ok(demo.cursorY >= 0 && demo.cursorY <= 176);
  if (demo.pressed) {
    near(demo.cursorX, 48);
    near(demo.cursorY, 134 - 92 * demo.target);
  }
}
assert.deepEqual(demoAt(0), demoAt(DEMO_PERIOD));
const last = demoAt(DEMO_PERIOD - 0.00001);
near(last.target, demoAt(0).target);
near(last.cursorX, demoAt(0).cursorX, 0.00001);
near(last.cursorY, demoAt(0).cursorY, 0.00001);

console.log('PASS motion: frame rates, drag stiffness, reversals, bounds, settle, area, reduced motion, vertical demo');
