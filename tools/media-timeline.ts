import { createMotion, stepMotion, type MotionState } from '../src/motion.ts';

/** The exported film is one 12-second cycle, sampled at an exact 60 fps. */
export const LOOP_SECONDS = 12;
export const LOOP_FPS = 60;
export const LOOP_FRAMES = LOOP_SECONDS * LOOP_FPS;

export interface MediaFrame {
  position: number;
  stretch: number;
  angle: number;
  target: number;
  /** Wrapped scene time. Pair it with WorldInput.loopDuration = LOOP_SECONDS. */
  time: number;
}

const LOW = 0.1;
const HIGH = 0.95;
const ASCENT_START = 1;
const ASCENT_END = 3.4;
const DESCENT_START = 6;
const DESCENT_END = 9.2;

function smootherstep(value: number): number {
  const u = Math.min(1, Math.max(0, value));
  return u * u * u * (10 + u * (-15 + 6 * u));
}

function targetAt(time: number): { target: number; moving: boolean } {
  if (time < ASCENT_START || time >= DESCENT_END) return { target: LOW, moving: false };
  if (time < ASCENT_END) {
    return {
      target: LOW + (HIGH - LOW) * smootherstep((time - ASCENT_START) / (ASCENT_END - ASCENT_START)),
      moving: true,
    };
  }
  if (time < DESCENT_START) return { target: HIGH, moving: false };
  return {
    target: HIGH + (LOW - HIGH) * smootherstep((time - DESCENT_START) / (DESCENT_END - DESCENT_START)),
    moving: true,
  };
}

function advance(state: MotionState, index: number): void {
  const phase = (index % LOOP_FRAMES) / LOOP_FPS;
  const { target, moving } = targetAt(phase);
  stepMotion(state, target, 1 / LOOP_FPS, moving, false);
}

function buildTimeline(): MediaFrame[] {
  const state = createMotion(LOW);
  // Settle the secondary wobble into the periodic orbit before recording. This
  // avoids treating the first frame as a special, artificially motionless frame.
  for (let index = 1; index <= LOOP_FRAMES * 4; index += 1) advance(state, index);
  const frames: MediaFrame[] = [];
  for (let index = 0; index < LOOP_FRAMES; index += 1) {
    const time = index / LOOP_FPS;
    frames.push({
      position: state.x,
      stretch: state.stretch,
      angle: state.angle,
      target: targetAt(time).target,
      time,
    });
    advance(state, index + 1);
  }
  return frames;
}

const frames = buildTimeline();

/** A fresh value object makes out-of-order export seeks safe and repeatable. */
export function mediaFrame(index: number): MediaFrame {
  const integer = Number.isFinite(index) ? Math.floor(index) : 0;
  const wrapped = ((integer % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES;
  return { ...frames[wrapped] };
}
