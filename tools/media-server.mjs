import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frames = path.join(root, '.local', 'vertical-frames');
const output = path.join(root, 'out', 'x-vertical');
await Promise.all(['portrait', 'square', 'checks'].map(name => mkdir(path.join(frames, name), { recursive: true })));
await mkdir(output, { recursive: true });
let saved = 0;
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
  plugins: [{
    name: 'local-media-sink',
    configureServer(vite) {
      vite.middlewares.use('/api/media', async (req, res) => {
        try {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          const origin = req.headers.origin;
          if (origin && origin !== 'http://127.0.0.1:4175') { res.statusCode = 403; res.end(); return; }
          const url = new URL(req.url ?? '/', 'http://127.0.0.1:4175');
          const kind = url.searchParams.get('kind'), name = url.searchParams.get('name');
          if (!name || !/^[a-z0-9-]+\.(png|json)$/.test(name)) { res.statusCode = 400; res.end(); return; }
          const directory = ['portrait', 'square', 'checks'].includes(kind) ? path.join(frames, kind) : kind === 'still' || kind === 'report' ? output : null;
          if (!directory) { res.statusCode = 400; res.end(); return; }
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw Error('Frame too large'); chunks.push(chunk); }
          await writeFile(path.join(directory, name), Buffer.concat(chunks)); saved += 1;
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ saved }));
          if (name === 'source-check.json') console.log(`Media capture complete: ${output}`);
        } catch (error) { res.statusCode = 500; res.end(String(error)); }
      });
    },
  }],
});
await server.listen();
console.log('Local media export: http://127.0.0.1:4175/media.html');
process.once('SIGINT', async () => { await server.close(); process.exit(0); });
