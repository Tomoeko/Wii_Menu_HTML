import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const localPath = (relative) => fileURLToPath(new URL(relative, import.meta.url));

/** A persistent, local original-code worker. Unavailability rejects explicitly;
 * callers must not present the authored fallback as native dictionary output.
 */
export function createDictionaryService({
  python = process.env.WII_DICTIONARY_PYTHON ||
    (existsSync(localPath('../.local/dictionary-runtime/bin/python'))
      ? localPath('../.local/dictionary-runtime/bin/python')
      : 'python3'),
  worker = localPath('./dictionary/worker.py'),
  state = localPath('../.local/prepare.json'),
  assets = localPath('../web/public/assets'),
  timeout = 3000,
  maxPending = 32,
} = {}) {
  let active = null;
  let sequence = 0;
  let outstanding = 0;
  let closed = false;

  const stop = (session, error, kill = true) => {
    if (session.stopped) return;
    session.stopped = true;
    session.error = error;
    clearTimeout(session.startTimer);
    if (active === session) active = null;
    session.rejectReady(error);
    for (const entry of session.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    session.pending.clear();
    session.lines.close();
    if (kill) session.child.kill();
  };

  const start = () => {
    if (closed) throw new Error('Dictionary service is closed');
    if (active) return active;
    const session = {
      child: spawn(python, [worker, '--state', state, '--assets', assets], {
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
      pending: new Map(),
      stopped: false,
      diagnostic: '',
    };
    active = session;
    session.ready = new Promise((resolve, reject) => {
      session.resolveReady = resolve;
      session.rejectReady = reject;
    });
    session.startTimer = setTimeout(() => {
      stop(session, new Error('Native dictionary worker did not start'));
    }, timeout);
    session.child.stderr.on('data', (data) => {
      session.diagnostic = (session.diagnostic + data.toString()).slice(-4096);
    });
    session.child.on('error', (error) => stop(session, error));
    session.child.stdin.on('error', (error) => stop(session, error));
    session.child.on('exit', () => {
      stop(
        session,
        new Error(session.diagnostic.trim() || 'Native dictionary worker stopped'),
        false,
      );
    });
    session.lines = createInterface({ input: session.child.stdout });
    session.lines.on('line', (line) => {
      if (session.stopped) return;
      let response;
      try {
        response = JSON.parse(line);
        if (!response || typeof response !== 'object') throw new Error('Invalid response');
      } catch {
        stop(session, new Error('Invalid native dictionary response'));
        return;
      }
      if ('ready' in response) {
        clearTimeout(session.startTimer);
        if (response.ready === true) session.resolveReady();
        else stop(session, new Error(response.error || 'Native dictionary is unavailable'));
        return;
      }
      const entry = session.pending.get(response.id);
      if (!entry) return;
      session.pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.error) entry.reject(new Error(response.error));
      else if (
        response.engine !== 'original-zi8' ||
        !Array.isArray(response.candidates) ||
        response.candidates.length > 40 ||
        !response.candidates.every((value) => typeof value === 'string' && value.length <= 255) ||
        (response.accepted !== undefined &&
          (typeof response.accepted !== 'string' || response.accepted.length > 63))
      ) {
        entry.reject(new Error('Invalid native dictionary candidates'));
      } else {
        const result = { engine: response.engine, candidates: response.candidates };
        if (response.accepted !== undefined) result.accepted = response.accepted;
        entry.resolve(result);
      }
    });
    return session;
  };

  return {
    async query({
      text = '', language = 'en', digits, session: editorSession,
      action = 'query', index, case: caseMode = 'lower',
    } = {}) {
      if (typeof text !== 'string' || text.length > 63 || !['en', 'fr', 'es'].includes(language)) {
        throw new TypeError('Invalid dictionary input');
      }
      if (digits !== undefined && (typeof digits !== 'string' || !/^[1-9]{1,63}$/.test(digits))) {
        throw new TypeError('Invalid telephone dictionary input');
      }
      if (editorSession !== undefined &&
          (typeof editorSession !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(editorSession))) {
        throw new TypeError('Invalid dictionary session');
      }
      if (!['query', 'reset', 'accept', 'close'].includes(action) ||
          !['title', 'lower', 'upper', 'unchanged'].includes(caseMode) ||
          (action === 'accept' && (!Number.isInteger(index) || index < 0 || index >= 40))) {
        throw new TypeError('Invalid dictionary action');
      }
      if (closed) throw new Error('Dictionary service is closed');
      if (outstanding >= maxPending) throw new Error('Native dictionary request queue is full');
      outstanding++;
      try {
        const session = start();
        await session.ready;
        if (session.stopped) throw session.error;
        return await new Promise((resolve, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            stop(session, new Error('Native dictionary request timed out'));
          }, timeout);
          session.pending.set(id, { resolve, reject, timer });
          session.child.stdin.write(
            `${JSON.stringify({
              id, text, language, digits, session: editorSession, action, index, case: caseMode,
            })}\n`,
            (error) => {
              if (error) stop(session, error);
            },
          );
        });
      } finally {
        outstanding--;
      }
    },
    close() {
      closed = true;
      if (active) stop(active, new Error('Dictionary service is closed'));
    },
  };
}
