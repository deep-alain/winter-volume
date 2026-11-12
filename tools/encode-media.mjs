import ffmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'out', 'x-vertical');
const frames = path.join(root, '.local', 'vertical-frames');
const FPS = 30, DURATION = 12, RATE = 48000;
await mkdir(output, { recursive: true });
const source = JSON.parse(await readFile(path.join(output, 'source-check.json'), 'utf8'));
if (source.frames !== 360 || source.renderer !== 'webgl2') throw Error('Expected complete real WebGL capture');
for (const check of Object.values(source.sourceChecks)) {
  if (check.endpointDifference !== 0 || check.seamDifference > Math.max(.025, check.neighborDifference * 1.4 + .008)) throw Error('Source loop seam failed');
}
function run(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let log = '';
    process.stdout.on('data', chunk => chunks.push(chunk));
    process.stderr.on('data', chunk => { log = (log + chunk).slice(-12000); });
    process.once('error', reject);
    process.once('close', code => code ? reject(Error(log)) : resolve({ data: Buffer.concat(chunks), log }));
  });
}
function smooth(value) { const x = Math.max(0, Math.min(1, value)); return x * x * x * (10 + x * (-15 + 6 * x)); }
function volume(t) {
  return t < 1 || t >= 9.2 ? .1 : t < 3.4 ? .1 + .85 * smooth((t - 1) / 2.4) : t < 6 ? .95 : .95 - .85 * smooth((t - 6) / 3.2);
}
// Original quiet ambience. Integer cycle counts keep wind periodic; the bells
// finish inside the summit hold so no sound is abruptly cut at the loop seam.
const count = DURATION * RATE, wav = Buffer.alloc(44 + count * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 4, 40);
let seed = 0x6d2b79f5;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const partials = Array.from({ length: 90 }, (_, i) => ({ cycles: 180 + i * 33 + Math.floor(rand() * 25), phase: rand() * Math.PI * 2, gain: .006 / (1 + i * .06) }));
let firstSample = 0, lastSample = 0, peak = 0;
for (let i = 0; i < count; i++) {
  const t = i / RATE, p = t / DURATION, v = volume(t);
  let wind = 0; for (const partial of partials) wind += Math.sin(p * Math.PI * 2 * partial.cycles + partial.phase) * partial.gain;
  wind *= (.3 + v * .55) * (1 + .12 * Math.sin(p * Math.PI * 4));
  const hum = Math.sin(p * Math.PI * 2 * 612) * .005 * (.15 + v);
  let bell = 0;
  for (const [onset, frequency] of [[4.05, 783.99], [4.55, 1174.66], [5.05, 1567.98]]) {
    const u = t - onset;
    if (u > 0 && u < 1.45) {
      const envelope = smooth(u / .025) * Math.exp(-u * 4.3) * (1 - smooth((u - 1.1) / .35));
      bell += (Math.sin(u * Math.PI * 2 * frequency) + Math.sin(u * Math.PI * 2 * frequency * 2.01) * .17) * envelope * .019;
    }
  }
  const left = Math.max(-.9, Math.min(.9, wind + hum + bell)), right = Math.max(-.9, Math.min(.9, wind * .94 + hum + bell * .96));
  wav.writeInt16LE(Math.round(left * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(right * 32767), 46 + i * 4);
  if (!i) firstSample = left; lastSample = left; peak = Math.max(peak, Math.abs(left), Math.abs(right));
}
const audio = path.join(frames, 'winter-ambience.wav'); await writeFile(audio, wav);
const media = [];
for (const variant of ['portrait', 'square']) {
  const file = `winter-volume-${variant}-loop.mp4`;
  // Independent frames at fixed quantization avoid a first-IDR / final-P-frame
  // reconstruction change at the cut. At this size the intra master stays small.
  const result = await run(['-y', '-hide_banner', '-loglevel', 'warning', '-thread_queue_size', '512', '-framerate', String(FPS), '-i', path.join(frames, variant, '%04d.png'), '-i', audio, '-frames:v', '360', '-t', String(DURATION), '-c:v', 'libx264', '-preset', 'slow', '-qp', '14', '-g', '1', '-keyint_min', '1', '-sc_threshold', '0', '-x264-params', 'aq-mode=0:ipratio=1:pbratio=1', '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', String(RATE), '-ac', '2', '-movflags', '+faststart', '-video_track_timescale', '30000', path.join(output, file)]);
  const data = await readFile(path.join(output, file));
  media.push({ file, width: 1080, height: variant === 'portrait' ? 1350 : 1080, fps: FPS, duration: DURATION, frames: 360, bytes: data.length, codecs: 'H.264 High / yuv420p + AAC LC stereo', encoderWarnings: result.log.trim() });
  console.log(`Encoded ${file}: ${(data.length / 1024 / 1024).toFixed(2)} MB`);
}
await writeFile(path.join(output, 'encoding-report.json'), JSON.stringify({ source, audio: { originalSynthesis: true, rate: RATE, peak, sourceBoundarySampleDifference: Math.abs(firstSample - lastSample) }, media }, null, 2));
