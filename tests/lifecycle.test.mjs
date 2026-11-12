import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real engine/world/motion with an instrumented browser boundary.
// The renderer is stubbed here; visual WebGL correctness is checked in-browser.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pending = new Map();
const subscriptions = [];
const rendered = [];
const renderers = [];
let nextFrame = 0;
class TrackedTarget extends EventTarget {
  addEventListener(type, listener, options) {
    subscriptions.push({ target: this, type, signal: options?.signal });
    super.addEventListener(type, listener, options);
  }
}
const windowMock = Object.assign(new TrackedTarget(), { devicePixelRatio: 2, innerWidth: 390, innerHeight: 844 });
const reduced = Object.assign(new TrackedTarget(), { matches: false });
const dark = Object.assign(new TrackedTarget(), { matches: false });
const context = vm.createContext({
  console, Uint8Array, URLSearchParams, AbortController,
  location: { search: '?demo=1' }, window: windowMock,
  matchMedia: query => query.includes('reduced') ? reduced : dark,
  requestAnimationFrame: callback => { pending.set(++nextFrame, callback); return nextFrame; },
  cancelAnimationFrame: id => pending.delete(id),
});
const modules = new Map();
function load(name) {
  if (name === './glass') return {
    createGlassRenderer() {
      const renderer = { mode: 'webgl2', draws: 0, disposed: 0, resize() {}, draw(world, frame) {
        this.draws++;
        rendered.push({ pixels: Uint8Array.from(world.color), position: frame.position, stretch: frame.stretch, angle: frame.angle, cursor: [...frame.cursor] });
      }, dispose() { this.disposed++; } };
      renderers.push(renderer);
      return renderer;
    },
  };
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(resolve(root, 'src', `${name.slice(2)}.ts`), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  modules.set(name, module.exports);
  const wrapper = vm.runInContext(`(function(require,module,exports){${output}\n})`, context);
  wrapper(load, module, module.exports);
  return module.exports;
}
function elements() {
  const slider = Object.assign(new TrackedTarget(), { value: '50', setAttribute() {}, focus() {}, hasPointerCapture() { return false; } });
  const style = { setProperty() {} };
  return {
    canvas: { dataset: {}, style: {}, parentElement: { style: {} } }, slider,
    status: { textContent: '音量 50%' }, room: { style }, value: { value: '' },
  };
}
const { mountEngine } = load('./engine');
const firstElements = elements();
const first = mountEngine(firstElements);
assert.equal(pending.size, 1, 'mount schedules one animation frame');
assert.ok(subscriptions.length >= 10, 'browser boundaries are exercised');
const firstSignal = subscriptions[0].signal;
assert.ok(firstSignal instanceof AbortSignal);
assert.ok(subscriptions.every(entry => entry.signal === firstSignal), 'all engine listeners share one AbortController');

first.renderAt(2.75);
const expected = rendered.at(-1);
assert.equal(pending.size, 0, 'deterministic seek cancels the live frame');
first.renderAt(8.1);
first.renderAt(2.75);
assert.deepEqual(rendered.at(-1), expected, 'seek output is independent of previous seek history');

// A real input hands control back from the deterministic renderer.
const key = new Event('keydown', { cancelable: true });
Object.defineProperties(key, { key: { value: 'End' }, shiftKey: { value: false } });
firstElements.slider.dispatchEvent(key);
assert.equal(firstElements.slider.value, '100');
assert.equal(pending.size, 1, 'input resumes exactly one live frame');
first.dispose();
first.dispose();
assert.equal(pending.size, 0, 'dispose cancels the pending frame');
assert.equal(firstSignal.aborted, true, 'dispose aborts every listener');
assert.equal(renderers[0].disposed, 1, 'dispose is idempotent');
const drawCount = renderers[0].draws;
first.renderAt(3);
firstElements.slider.dispatchEvent(key);
windowMock.dispatchEvent(new Event('resize'));
assert.equal(renderers[0].draws, drawCount, 'disposed engine cannot draw or react to input');
assert.equal(pending.size, 0);

// React StrictMode's mount → dispose → mount pattern owns a fresh signal/RAF.
const oldSubscriptionCount = subscriptions.length;
const second = mountEngine(elements());
assert.equal(pending.size, 1);
assert.notEqual(subscriptions[oldSubscriptionCount].signal, firstSignal);
second.renderAt(2.75);
assert.deepEqual(rendered.at(-1), expected, 'a fresh mount produces the same fixed-clock scene');
second.dispose();
assert.equal(renderers[1].disposed, 1);
assert.equal(pending.size, 0);

// Check the real GL renderer's resource ownership independently of the driver.
const allocated = [], deleted = [];
const constants = Object.fromEntries(['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'TEXTURE0', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'NEAREST', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RGBA8', 'RGBA', 'UNSIGNED_BYTE', 'COLOR_BUFFER_BIT', 'TRIANGLES'].map((name, i) => [name, i + 1]));
const gl = new Proxy(constants, { get(target, name) {
  if (name in target) return target[name];
  if (String(name).startsWith('create')) return () => { const object = { kind: name }; allocated.push(object); return object; };
  if (String(name).startsWith('delete')) return object => deleted.push(object);
  if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
  if (name === 'getUniformLocation') return (_program, uniform) => uniform;
  return () => {};
} });
const glassModule = { exports: {} };
const glassSource = readFileSync(resolve(root, 'src/glass.ts'), 'utf8');
const glassOutput = ts.transpileModule(glassSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInContext(`(function(require,module,exports){${glassOutput}\n})`, context)(load, glassModule, glassModule.exports);
const glCanvas = { width: 0, height: 0, getContext(kind, options) {
  assert.equal(kind, 'webgl2');
  assert.equal(options.premultipliedAlpha, true);
  assert.equal(options.antialias, false);
  assert.equal(options.preserveDrawingBuffer, true, 'paused fixed-time renders remain available after presentation');
  return gl;
} };
const actualRenderer = glassModule.exports.createGlassRenderer(glCanvas);
actualRenderer.resize(192, 352);
assert.equal(glCanvas.width, 192);
assert.equal(glCanvas.height, 352);
actualRenderer.dispose();
assert.equal(allocated.length, 7, 'renderer allocates program, two shaders, vertex array, and three textures');
assert.equal(deleted.length, 7);
assert.equal(new Set(deleted).size, 7, 'each owned GL object is deleted once');
assert.ok(allocated.every(object => deleted.includes(object)), 'dispose deletes every allocated GL object');

// Hand-edited URLs must not send NaN into the world/light pipeline.
context.location.search = '?value=abc';
const invalidElements = elements();
const invalidValueEngine = mountEngine(invalidElements);
assert.equal(invalidElements.slider.value, '32', 'invalid value query falls back to the light-mode initial value');
assert.equal(invalidElements.status.textContent, '音量 32%', 'initial live status matches the actual value');
assert.equal(invalidElements.canvas.dataset.position, '0.32000');
invalidValueEngine.dispose();
assert.equal(pending.size, 0);
console.log('Lifecycle, GL ownership, and fixed-clock render regression checks passed.');
