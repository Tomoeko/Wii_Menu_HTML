import http from 'node:http';
import { readFile, stat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDictionaryService } from './dictionary-service.mjs';
import { formatJson } from './format-json.mjs';
import { createChannelManager, handleChannelManagerRequest } from './channel-manager.mjs';
import { readStorageState, writeStorageState, readStorageFixture } from './storage-state.mjs';
import { readRemoteState, writeRemoteState } from './remote-state.mjs';
import { appendLocalLetter, readLetterOutbox, readMessageFixture } from './message-service.mjs';
import { ConfigurationBusyError } from './configuration.mjs';
import { readGraphicsSettings, writeGraphicsSettings } from './graphics-settings.mjs';
import {
  readArrangement,
  writeArrangement,
  readMessageBoard,
  mergeMessageBoard,
  eraseIncomingLetter,
  eraseMemo,
} from './local-state.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const port = Number(process.env.PORT || 5173);
const captures = fileURLToPath(new URL('../artifacts/browser-captures/', import.meta.url));
const arrangementFile = fileURLToPath(new URL('../.local/channel-layout.json', import.meta.url));
const messageBoardFile = fileURLToPath(new URL('../.local/message-board.json', import.meta.url));
const storageStateFile = fileURLToPath(new URL('../.local/storage-state.json', import.meta.url));
const storageFixtureFile = fileURLToPath(new URL('../.local/storage-fixture.json', import.meta.url));
const remoteStateFile = fileURLToPath(new URL('../.local/remote-state.json', import.meta.url));
const messageFixtureFile = fileURLToPath(new URL('../.local/message-fixture.json', import.meta.url));
const letterOutboxFile = fileURLToPath(new URL('../.local/letter-outbox.json', import.meta.url));
const configFile = fileURLToPath(new URL('../config.json', import.meta.url));
const dictionary = createDictionaryService();
const channelManager = createChannelManager();
process.on('exit', () => dictionary.close());
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

async function readRequestText(req, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error('Local request too large');
    chunks.push(chunk);
  }
  // HTTP chunks can split a UTF-8 character. Decode only the complete bytes,
  // rejecting invalid input instead of silently persisting replacement glyphs.
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

async function readRequestJson(req, maximumBytes) {
  return JSON.parse(await readRequestText(req, maximumBytes));
}

http
  .createServer(async (req, res) => {
    try {
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Local host required');
        return;
      }
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Settings runs in an opaque-origin sandbox. CORP same-origin would
      // prevent that engine from loading its own original scripts and images.
      // Host/origin checks and the content policy enforce local-only access.
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const originalSettingsPage = pathname.startsWith('/assets/settings/');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          // The original Settings scripts use string callbacks in timers.
          // Permit those only within the separately sandboxed Settings engine.
          `script-src 'self' 'unsafe-inline'${originalSettingsPage ? " 'unsafe-eval'" : ''}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "media-src 'self' blob:",
          "connect-src 'self'",
          "frame-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; '),
      );
      if (
        await handleChannelManagerRequest(req, res, {
          pathname,
          port,
          manager: channelManager,
        })
      )
        return;
      if (pathname === '/api/dictionary' && req.method === 'POST') {
        if (req.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('Invalid origin');
        const body = await readRequestText(req, 2048);
        try {
          const result = await dictionary.query(JSON.parse(body));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch {
          // Do not expose worker diagnostics, input text, or private local paths.
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(
            JSON.stringify({
              error:
                'Original dictionary is unavailable. Check local preparation and runtime dependencies.',
            }),
          );
        }
        return;
      }
      if (['/api/message-board/erase-letter', '/api/message-board/erase-memo'].includes(pathname)) {
        if (req.headers.origin !== `http://${req.headers.host}`) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Local origin required.' }));
          return;
        }
        try {
          if (req.method !== 'POST') throw new Error('Unsupported method');
          const erase = pathname.endsWith('erase-memo') ? eraseMemo : eraseIncomingLetter;
          const result = await erase(messageBoardFile, await readRequestJson(req, 1024));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Could not erase the selected local Board record.' }));
        }
        return;
      }
      if (pathname === '/api/message-board') {
        try {
          let result;
          if (req.method === 'GET') result = await readMessageBoard(messageBoardFile);
          else if (req.method === 'PUT') {
            if (req.headers.origin !== `http://${req.headers.host}`) throw new Error('Invalid origin');
            const body = await readRequestJson(req, 16 * 1024 * 1024);
            result = await mergeMessageBoard(messageBoardFile, body);
          } else throw new Error('Unsupported method');
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify(result));
        } catch (error) {
          const conflict = error.code === 'BOARD_CONFLICT';
          res.writeHead(conflict ? 409 : req.method === 'GET' ? 503 : 400, {
            'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: conflict
            ? 'The Message Board changed in another session. Reload before retrying.'
            : 'Local Message Board data is unavailable or invalid.' }));
        }
        return;
      }
      if (pathname === '/api/message-fixture' || pathname === '/api/letter-outbox') {
        try {
          let result;
          if (req.method === 'GET') {
            result = pathname === '/api/message-fixture'
              ? await readMessageFixture(messageFixtureFile)
              : await readLetterOutbox(letterOutboxFile);
          } else if (pathname === '/api/letter-outbox' && req.method === 'POST') {
            if (req.headers.origin !== `http://${req.headers.host}`) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Local origin required.' }));
              return;
            }
            const fixture = await readMessageFixture(messageFixtureFile);
            if (fixture.letterService !== 'local') {
              throw new Error('The local Letter fixture is disabled.');
            }
            result = await appendLocalLetter(letterOutboxFile, await readRequestJson(req, 16384));
          } else throw new Error('Unsupported local message method.');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(req.method === 'GET' ? 503 : 400, {
            'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: 'Local message fixture or outbox is unavailable or invalid.' }));
        }
        return;
      }
      if (pathname === '/api/remote-state') {
        try {
          let result;
          if (req.method === 'GET') result = await readRemoteState(remoteStateFile);
          else if (req.method === 'PUT') {
            if (req.headers.origin !== `http://${req.headers.host}`) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Local origin required.' }));
              return;
            }
            result = await writeRemoteState(remoteStateFile, await readRequestJson(req, 4096));
          } else throw new Error('Unsupported remote-state method.');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(req.method === 'GET' ? 503 : 400, {
            'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: 'Local remote state is unavailable or invalid.' }));
        }
        return;
      }
      if (pathname === '/api/storage-state' || pathname === '/api/storage-fixture') {
        try {
          let result;
          if (req.method === 'GET') {
            result = pathname === '/api/storage-state'
              ? await readStorageState(storageStateFile)
              : await readStorageFixture(storageFixtureFile);
          } else if (pathname === '/api/storage-state' && req.method === 'PUT') {
            if (req.headers.origin !== `http://${req.headers.host}`) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Local origin required.' }));
              return;
            }
            result = await writeStorageState(storageStateFile, await readRequestJson(req, 4096));
          } else throw new Error('Unsupported storage method.');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result));
        } catch {
          res.writeHead(req.method === 'GET' ? 503 : 400, {
            'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: 'Local storage state is unavailable or invalid.' }));
        }
        return;
      }
      if (pathname === '/api/layout') {
        let result;
        if (req.method === 'GET') result = await readArrangement(arrangementFile);
        else if (req.method === 'PUT') {
          if (req.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('Invalid origin');
          result = await writeArrangement(arrangementFile, await readRequestJson(req, 256 * 1024));
        } else throw new Error('Unsupported method');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(result));
        return;
      }
      if (pathname === '/api/graphics') {
        const send = (status, value) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(value));
        };
        if (!['GET', 'PUT'].includes(req.method)) {
          send(405, { error: 'This graphics method is not supported.' });
          return;
        }
        if (req.method === 'PUT' && req.headers.origin !== `http://${req.headers.host}`) {
          send(403, { error: 'Graphics changes require the local page origin.' });
          return;
        }
        try {
          const graphics = req.method === 'GET'
            ? await readGraphicsSettings(configFile)
            : await writeGraphicsSettings(configFile, await readRequestJson(req, 2048));
          send(200, { graphics });
        } catch (error) {
          const busy = error instanceof ConfigurationBusyError;
          send(busy ? 409 : 400, {
            error: busy ? error.message : 'Could not read or save graphics settings. Check the values and try again.',
          });
        }
        return;
      }
      if (pathname === '/config.json' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(await readFile(configFile));
        return;
      }
      // The inspector's explicit save button stores comparison frames locally.
      if (req.method === 'POST' && pathname === '/__capture') {
        if (req.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('Invalid origin');
        const data = await readRequestJson(req, 12 * 1024 * 1024);
        if (
          typeof data.png !== 'string' ||
          !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.png)
        )
          throw new Error('Expected PNG');
        const png = Buffer.from(data.png.split(',')[1], 'base64');
        if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
          throw new Error('Invalid PNG');
        const name = `${Date.now()}-${randomUUID().slice(0, 8)}`;
        if (
          data.comparison !== undefined &&
          (!data.comparison ||
            typeof data.comparison !== 'object' ||
            Array.isArray(data.comparison) ||
            Buffer.byteLength(JSON.stringify(data.comparison), 'utf8') > 64 * 1024)
        )
          throw new Error('Invalid comparison metadata');
        const metadata = {
          channel: String(data.channel ?? '').slice(0, 64),
          kind: String(data.kind).slice(0, 16),
          frame: Number(data.frame),
          capturedAt: new Date().toISOString(),
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
          aspectRatio: ['4:3', '16:9'].includes(data.aspectRatio) ? data.aspectRatio : null,
          logicalWidth: Number(data.logicalWidth) || null,
          logicalHeight: Number(data.logicalHeight) || null,
          ...(data.comparison === undefined ? {} : { comparison: data.comparison }),
        };
        await mkdir(captures, { recursive: true });
        await writeFile(resolve(captures, name + '.png'), png, { flag: 'wx' });
        await writeFile(
          resolve(captures, name + '.json'),
          formatJson(metadata),
          { flag: 'wx' },
        );
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: `artifacts/browser-captures/${name}.png` }));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new Error('Unsupported method');
      const relative = pathname.startsWith('/assets/')
        ? `public${pathname}`
        : pathname === '/'
          ? 'index.html'
          : pathname.slice(1);
      const file = await realpath(resolve(root, relative));
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(file)).isFile())
        throw new Error('Not found');
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...(['.ttf', '.otf'].includes(extname(file)) ? { 'Access-Control-Allow-Origin': '*' } : {}),
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`Wii menu: http://127.0.0.1:${port}`));
