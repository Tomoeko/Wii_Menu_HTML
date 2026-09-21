/** Read-only allowlist for preparing a separate public source directory. */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPrivacy } from './audit-privacy.mjs';
import { createExampleAudio } from './custom-channel-audio.mjs';
import { DEFAULT_CONFIG } from '../web/src/config.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rootFiles = new Set([
  '.gitignore', '.editorconfig', '.prettierrc.json',
  'AGENTS.md', 'README.md', 'package.json', 'config.json',
  'LICENSE', 'NOTICE',
]);
const sourceDirectories = new Set(['defaults', 'docs', 'examples', 'templates', 'tools', 'web']);
const excludedNames = new Set([
  '.git', '.local', 'private', 'artifacts', 'node_modules', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'coverage', '.DS_Store',
]);
const textExtensions = new Set(['.js', '.mjs', '.py', '.html', '.css', '.json', '.md', '.txt']);
const sampleAudioPaths = new Set([
  'examples/custom-channels/custom-example/sound.wav',
  'templates/custom-channel/sound.wav',
]);
const historicalDocuments = new Set([
  'docs/implementation-history.md', 'docs/historical-fidelity-notes.md',
]);
const requiredFiles = [
  '.gitignore', 'AGENTS.md', 'README.md', 'LICENSE', 'package.json', 'config.json',
  'defaults/channel-layout.json', 'defaults/message-board.json',
  'web/index.html', 'web/src/main.js', 'tools/serve.mjs', 'tools/init-state.mjs',
  'tools/assets/prepare.py', 'tools/audit-privacy.mjs',
];
const maximumSourceBytes = 4 * 1024 * 1024;
const formatJson = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Local configuration and saved defaults must never seed a public repository. */
export function publicDefaultBytes(name) {
  if (name === 'config.json') return formatJson(DEFAULT_CONFIG);
  if (name === 'defaults/message-board.json') return formatJson({ version: 1, memos: [] });
  if (name === 'defaults/channel-layout.json') {
    return formatJson({ version: 1, slots: ['disc', ...Array(47).fill(null)] });
  }
  return null;
}

export function publicSourcePolicy(name, { includeHistoricalDocs = true } = {}) {
  const parts = name.split('/');
  if (parts.some((part) => excludedNames.has(part))) return 'excluded';
  if (name === 'web/public' || name.startsWith('web/public/')) return 'excluded';
  if (!includeHistoricalDocs && historicalDocuments.has(name)) return 'excluded';
  if (parts[0] === 'examples') {
    if (name === 'examples' || name === 'examples/custom-channels') return 'directory';
    if (!name.startsWith('examples/storage-fixtures/') &&
        !name.startsWith('examples/custom-channels/custom-example/') &&
        !['examples/storage-fixtures', 'examples/custom-channels/custom-example'].includes(name)) {
      return 'excluded';
    }
  }
  if (parts[0] === 'templates' && name !== 'templates' &&
      name !== 'templates/custom-channel' && !name.startsWith('templates/custom-channel/')) {
    return 'excluded';
  }
  if (parts.length === 1) {
    if (rootFiles.has(name)) return 'file';
    return sourceDirectories.has(name) ? 'directory' : 'excluded';
  }
  if (!sourceDirectories.has(parts[0])) return 'excluded';
  return 'source';
}

/**
 * Inventory only; never copies, deletes, stages, or initializes a repository.
 * Returned hashes describe export bytes, including regenerated empty defaults.
 */
export async function planPublicSource(root = projectRoot, options = {}) {
  const files = [];
  const excluded = [];
  const findings = [];
  const sampleAudio = createExampleAudio();
  const base = resolve(root);
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const policy = publicSourcePolicy(name, options);
      if (policy === 'excluded') {
        excluded.push(name);
        continue;
      }
      if (entry.isSymbolicLink()) {
        findings.push({ file: name, category: 'symlink is not public source' });
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (policy === 'file') {
          findings.push({ file: name, category: 'expected a regular source file' });
        } else {
          await visit(path, name);
        }
        continue;
      }
      if (!entry.isFile() || policy === 'directory') {
        findings.push({ file: name, category: 'expected an authored file or directory' });
        continue;
      }
      const isSampleAudio = sampleAudioPaths.has(name);
      if (!rootFiles.has(name) && !isSampleAudio && !textExtensions.has(extname(name))) {
        findings.push({ file: name, category: 'file type needs explicit public-source review' });
        continue;
      }
      if ((await lstat(path)).size > maximumSourceBytes) {
        findings.push({ file: name, category: 'source file exceeds review size limit' });
        continue;
      }
      const originalBytes = await readFile(path);
      const defaults = publicDefaultBytes(name);
      const bytes = defaults ?? originalBytes;
      if (isSampleAudio) {
        if (!bytes.equals(sampleAudio)) {
          findings.push({ file: name, category: 'sample audio differs from authored generator' });
          continue;
        }
      } else {
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (/\x00/.test(text)) throw new Error('NUL byte');
        } catch {
          findings.push({ file: name, category: 'source file is not plain UTF-8 text' });
          continue;
        }
        for (const finding of inspectPrivacy(text, options.identity)) {
          findings.push({ file: name, ...finding });
        }
      }
      if (options.requireClean && defaults && !originalBytes.equals(defaults)) {
        findings.push({ file: name, category: 'file differs from clean public defaults' });
      }
      files.push({
        path: name,
        bytes: bytes.length,
        sha256: sha256(bytes),
        source: defaults ? 'public-default' : 'authored',
      });
    }
  }
  await visit(base);
  const names = new Set(files.map((file) => file.path));
  for (const name of requiredFiles) {
    if (!names.has(name)) findings.push({ file: name, category: 'required standalone file missing' });
  }
  if (options.requireClean) {
    for (const name of excluded) {
      // Git metadata never enters the export. A fresh destination may already
      // be initialized; commit history and remotes require their own review.
      if (name === '.git' || name === 'ROADMAP.md') continue;
      findings.push({ file: name, category: 'excluded content is present in public directory' });
    }
  }
  return { files, excluded, findings };
}

/** Check the reviewed byte hash again immediately before a caller writes it. */
export async function readPublicSourceFile(root, entry) {
  if (!entry || typeof entry.path !== 'string' ||
      entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      entry.path.includes('\\') || publicSourcePolicy(entry.path) === 'excluded') {
    throw new Error('Invalid public source entry.');
  }
  let path = resolve(root);
  for (const part of entry.path.split('/')) {
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Source changed to a symlink.');
  }
  const bytes = publicDefaultBytes(entry.path) ?? await readFile(path);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Public source changed after review: ${entry.path}`);
  }
  return bytes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((argument) => !['--clean', '--omit-history'].includes(argument))) {
    console.error('Usage: node tools/public-source.mjs [--clean] [--omit-history]');
    process.exitCode = 1;
  } else {
    const result = await planPublicSource(projectRoot, {
      requireClean: args.includes('--clean'),
      includeHistoricalDocs: !args.includes('--omit-history'),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.findings.length ? 1 : 0;
  }
}
