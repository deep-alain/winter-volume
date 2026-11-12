/** Normalized slider motion. The engine owns the target and input state. */
export interface MotionState {
  x: number;
  v: number;
  angle: number;
  angularVelocity: number;
  /** Scale along the path; use its reciprocal across the path to preserve area. */
  stretch: number;
}

export interface DemoFrame {
  target: number;
  cursorX: number;
  cursorY: number;
  pressed: boolean;
  visible: boolean;
}

export const DEMO_PERIOD = 10;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalized = (value: number): number =>
  Number.isFinite(value) ? clamp(value, 0, 1) : 0;

const ease = (value: number): number => {
  const u = clamp(value, 0, 1);
  return u * u * u * (10 + u * (-15 + 6 * u));
};

const mix = (from: number, to: number, u: number): number =>
  from + (to - from) * u;

export function createMotion(initial: number): MotionState {
  return {
    x: normalized(initial),
    v: 0,
    angle: 0,
    angularVelocity: 0,
    stretch: 1,
  };
}

/**
 * Exact critically damped position following plus a separately damped glass wobble.
 * No release impulse is added for a continuous slider: keep passing its final target.
 */
export function stepMotion(
  state: MotionState,
  target: number,
  dt: number,
  dragging: boolean,
  reduced: boolean,
): void {
  const goal = normalized(target);
  if (reduced) {
    state.x = goal;
    state.v = 0;
    state.angle = 0;
    state.angularVelocity = 0;
    state.stretch = 1;
    return;
  }

  const elapsed = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
  if (elapsed === 0) return;

  // The closed-form spring remains stable when a frame stalls or input reverses.
  const omega = dragging ? 32 : 17;
  const previousVelocity = state.v;
  const displacement = state.x - goal;
  const impulse = state.v + omega * displacement;
  const decay = Math.exp(-omega * elapsed);
  state.x = goal + (displacement + impulse * elapsed) * decay;
  state.v = (state.v - omega * impulse * elapsed) * decay;

  if (state.x < 0 || state.x > 1) {
    state.x = clamp(state.x, 0, 1);
    // A bounded control cannot carry outward momentum through its end stop.
    state.v = 0;
  }
  if (Math.abs(state.x - goal) < 0.00001 && Math.abs(state.v) < 0.0002) {
    state.x = goal;
    state.v = 0;
  }

  const acceleration = clamp((state.v - previousVelocity) / elapsed, -700, 700);
  const steps = Math.max(1, Math.ceil(elapsed * 120));
  const h = elapsed / steps;
  for (let i = 0; i < steps; i += 1) {
    const angularAcceleration =
      -52 * state.angle - 7.5 * state.angularVelocity - acceleration * 0.0028;
    state.angularVelocity += angularAcceleration * h;
    state.angle += state.angularVelocity * h;
    if (Math.abs(state.angle) > 0.12) {
      state.angle = clamp(state.angle, -0.12, 0.12);
      state.angularVelocity *= 0.4;
    }
  }

  const wantedStretch = 1 + Math.min(0.25, Math.abs(state.v) * 0.065);
  state.stretch += (wantedStretch - state.stretch) * (1 - Math.exp(-18 * elapsed));
  if (Math.abs(state.stretch - 1) < 0.00001) state.stretch = 1;
}

/** Scripted, repeatable pointer drag in the engine's 96 × 176 logical canvas. */
export function demoAt(time: number): DemoFrame {
  const safeTime = Number.isFinite(time) ? time : 0;
  const t = ((safeTime % DEMO_PERIOD) + DEMO_PERIOD) % DEMO_PERIOD;
  const low = 0.1;
  const high = 0.95;
  const yAt = (value: number): number => 134 - value * 92;
  let target = low;
  let cursorX = 88;
  let cursorY = 165;
  let pressed = false;

  if (t < 1.2) {
    const u = ease(t / 1.2);
    cursorX = mix(88, 48, u);
    cursorY = mix(165, yAt(low), u);
  } else if (t < 4.2) {
    target = mix(low, high, ease((t - 1.4) / 2.8));
    cursorX = 48;
    cursorY = yAt(target);
    pressed = true;
  } else if (t < 5.6) {
    target = high;
    const u = ease((t - 4.35) / 0.9);
    cursorX = mix(48, 88, u);
    cursorY = mix(yAt(high), 165, u);
  } else if (t < 6.3) {
    target = high;
    const u = ease((t - 5.6) / 0.7);
    cursorX = mix(88, 48, u);
    cursorY = mix(165, yAt(high), u);
  } else if (t < 9.1) {
    target = mix(high, low, ease((t - 6.5) / 2.6));
    cursorX = 48;
    cursorY = yAt(target);
    pressed = true;
  } else {
    const u = ease((t - 9.25) / 0.75);
    cursorX = mix(48, 88, u);
    cursorY = mix(yAt(low), 165, u);
  }

  return { target, cursorX, cursorY, pressed, visible: true };
}
