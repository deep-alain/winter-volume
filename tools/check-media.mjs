import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import ffmpeg from 'ffmpeg-static';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'out', 'x-vertical');
const FPS = 30, DURATION = 12, FRAME_COUNT = FPS * DURATION, RATE = 48000;
const source = JSON.parse(await readFile(path.join(out, 'source-check.json'), 'utf8'));
const encoding = JSON.parse(await readFile(path.join(out, 'encoding-report.json'), 'utf8'));

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const data = []; let log = '';
    child.stdout.on('data', chunk => data.push(chunk));
    child.stderr.on('data', chunk => { log += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code ? reject(Error(log)) : resolve({ data: Buffer.concat(data), log }));
  });
}

function meanDifference(a, b) {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / a.length;
}

function atoms(buffer) {
  const result = []; let offset = 0;
  while (offset < buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const name = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1) size = Number(buffer.readBigUInt64BE(offset + 8));
    if (size === 0) size = buffer.length - offset;
    assert.ok(size >= 8 && offset + size <= buffer.length, 'invalid MP4 atom bounds');
    result.push({ name, offset, size }); offset += size;
  }
  assert.equal(offset, buffer.length);
  return result;
}

function audioStats(data, channels, nominalSamples) {
  assert.ok(data.length / 4 >= nominalSamples * channels, 'decoded AAC ended before the nominal video timeline');
  const decodedPerChannel = data.length / 4 / channels;
  // AAC frame padding is allowed after the nominal 12-second timeline. Do not
  // mistake it for authored silence at the visual loop's endpoint.
  const sample = (index, channel) => data.readFloatLE((index * channels + channel) * 4);
  const window = 480;
  const rms = (from, to, channel) => {
    let sum = 0;
    for (let index = from; index < to; index += 1) sum += sample(index, channel) ** 2;
    return Math.sqrt(sum / (to - from));
  };
  const boundaries = [];
  let peak = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    let adjacentMax = 0;
    for (let index = 1; index < nominalSamples; index += 1) {
      const value = sample(index, channel);
      peak = Math.max(peak, Math.abs(value));
      if (index < window || index >= nominalSamples - window) {
        adjacentMax = Math.max(adjacentMax, Math.abs(value - sample(index - 1, channel)));
      }
    }
    const seam = Math.abs(sample(0, channel) - sample(nominalSamples - 1, channel));
    const firstRms = rms(0, window, channel), lastRms = rms(nominalSamples - window, nominalSamples, channel);
    assert.ok(seam <= Math.max(.0005, adjacentMax * 2.5), `AAC channel ${channel} has an abnormal boundary step: ${seam} vs ${adjacentMax}`);
    assert.ok(firstRms > .0001 && lastRms > .0001, `AAC channel ${channel} contains a silent edge`);
    assert.ok(lastRms / firstRms > .5 && lastRms / firstRms < 2, `AAC channel ${channel} has a boundary loudness notch`);
    boundaries.push({ channel, boundarySampleDifference: seam, nearBoundaryMaxAdjacentDifference: adjacentMax, first10msRms: firstRms, last10msRms: lastRms });
  }
  assert.ok(peak > .001 && peak < .99, 'audio is silent or clipped');
  return { rate: RATE, channels, decodedSamplesPerChannel: decodedPerChannel, nominalSamplesPerChannel: nominalSamples, trailingCodecPaddingSamples: decodedPerChannel - nominalSamples, peak, boundaries, seam: 'passed' };
}

const report = {
  checkedAt: new Date().toISOString(),
  duration: DURATION,
  fps: FPS,
  source: {
    renderer: source.renderer,
    frames: source.frames,
    exactSourceEndpointsMatch: Object.values(source.sourceChecks).every(check => check.endpointDifference === 0),
    seamChecks: source.sourceChecks,
  },
  audioSource: encoding.audio,
  videos: [],
  images: [],
};
assert.equal(source.frames, FRAME_COUNT);
assert.equal(source.renderer, 'webgl2');
assert.ok(report.source.exactSourceEndpointsMatch);
assert.ok(encoding.audio.originalSynthesis);
assert.ok(encoding.audio.sourceBoundarySampleDifference < .001);

const cellW = 270, labelH = 42, gap = 16, margin = 24;
const contact = createCanvas(6 * cellW + 5 * gap + margin * 2, 338 + 270 + labelH * 2 + gap + margin * 2);
const contactContext = contact.getContext('2d');
contactContext.fillStyle = '#e8edee'; contactContext.fillRect(0, 0, contact.width, contact.height);
contactContext.imageSmoothingEnabled = false;

for (const variant of ['portrait', 'square']) {
  const file = `winter-volume-${variant}-loop.mp4`, filename = path.join(out, file);
  const fullHeight = variant === 'portrait' ? 1350 : 1080;
  const decoded = await run(['-hide_banner', '-xerror', '-i', filename, '-map', '0:v:0', '-an', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-']);
  const inputMetadata = decoded.log.split('Stream mapping:')[0];
  assert.match(inputMetadata, /Video: h264/);
  assert.match(inputMetadata, /yuv420p/);
  assert.match(inputMetadata, new RegExp(`1080x${fullHeight}`));
  assert.match(inputMetadata, /30 fps/);
  assert.match(inputMetadata, /Audio: aac/);
  assert.match(inputMetadata, /48000 Hz, stereo/);
  const duration = inputMetadata.match(/Duration: (\d+):(\d+):([\d.]+)/);
  assert.ok(duration, 'container duration is reported');
  const seconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  assert.equal(seconds, DURATION);
  const frameCounts = [...decoded.data.toString().matchAll(/^frame=(\d+)$/gm)].map(match => Number(match[1]));
  assert.equal(frameCounts.at(-1), FRAME_COUNT);
  const compressed = await readFile(filename), boxes = atoms(compressed);
  assert.ok(boxes.find(box => box.name === 'moov').offset < boxes.find(box => box.name === 'mdat').offset, 'MP4 faststart places metadata first');

  const height = variant === 'portrait' ? 338 : 270;
  const selected = await run(['-v', 'error', '-xerror', '-i', filename, '-vf', `select=lte(n\\,2)+gte(n\\,${FRAME_COUNT - 3}),scale=${cellW}:${height}:flags=neighbor`, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  const bytesPerFrame = cellW * height * 3;
  assert.equal(selected.data.length, 6 * bytesPerFrame);
  const frames = [3, 4, 5, 0, 1, 2].map(index => selected.data.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame));
  const differences = frames.slice(1).map((frame, index) => meanDifference(frames[index], frame));
  const seam = differences[2], neighborMax = Math.max(...differences.filter((_, index) => index !== 2));
  // Compression changes very small pixel differences; compare against adjacent
  // decoded motion rather than expecting byte-identical first and last frames.
  const visualPassed = seam <= Math.max(.035, neighborMax * 1.5 + .015);

  const rowY = variant === 'portrait' ? margin : margin + 338 + labelH + gap;
  frames.forEach((frame, index) => {
    const canvas = createCanvas(cellW, height), context = canvas.getContext('2d'), image = context.createImageData(cellW, height);
    for (let pixel = 0; pixel < cellW * height; pixel += 1) {
      image.data[pixel * 4] = frame[pixel * 3]; image.data[pixel * 4 + 1] = frame[pixel * 3 + 1]; image.data[pixel * 4 + 2] = frame[pixel * 3 + 2]; image.data[pixel * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const x = margin + index * (cellW + gap);
    contactContext.drawImage(canvas, x, rowY);
    contactContext.fillStyle = '#253747'; contactContext.font = '14px sans-serif';
    const seconds = index < 3 ? DURATION - (3 - index) / FPS : (index - 3) / FPS;
    contactContext.fillText(`${index < 3 ? 'END' : 'START'}  ${seconds.toFixed(4)}s`, x + 8, rowY + height + 26);
  });

  const audio = await run(['-v', 'error', '-xerror', '-i', filename, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', 'pipe:1']);
  const audioCheck = audioStats(audio.data, 2, DURATION * RATE);
  report.videos.push({ file, width: 1080, height: fullHeight, duration: seconds, fps: FPS, frames: frameCounts.at(-1), codec: 'H.264 / yuv420p + AAC LC stereo', bytes: compressed.length, faststart: true, decode: 'passed', visualLoop: { seamMeanAbsoluteRgbDifference: seam, neighborMaxMeanAbsoluteRgbDifference: neighborMax, seamToNeighborRatio: seam / neighborMax, differences, seam: visualPassed ? 'passed' : 'failed', backgroundPixels: frames.map(frame => [...frame.subarray(0, 3)]) }, audio: audioCheck });
}

for (const [file, width, height] of [
  ['cover-1080x1350.png', 1080, 1350], ['day-1080x1350.png', 1080, 1350],
  ['detail-1080x1080.png', 1080, 1080], ['stages-1600x1000.png', 1600, 1000],
]) {
  const bytes = await readFile(path.join(out, file));
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  report.images.push({ file, width, height, bytes: bytes.length, pngHeader: 'passed' });
}
await writeFile(path.join(out, 'seam-contact.png'), contact.toBuffer('image/png'));
await writeFile(path.join(out, 'media-check.json'), JSON.stringify(report, null, 2) + '\n');
assert.ok(report.videos.every(video => video.visualLoop.seam === 'passed'), 'Encoded visual loop seam failed; inspect media-check.json');
console.log(JSON.stringify({ sourceEndpointsMatch: report.source.exactSourceEndpointsMatch, videos: report.videos.map(video => ({ file: video.file, size: `${video.width}x${video.height}`, fps: video.fps, frames: video.frames, decode: video.decode, visualSeam: video.visualLoop.seam, audioSeam: video.audio.seam })), images: report.images.length }, null, 2));
