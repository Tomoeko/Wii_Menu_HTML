import { readdir, readFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ignoredDirectories = new Set([
  '.git', '.local', 'artifacts', 'node_modules', '.venv', 'venv', '__pycache__',
]);
const textExtensions = new Set([
  '.js', '.mjs', '.py', '.html', '.css', '.json', '.md', '.txt', '.toml', '.ini', '.yml', '.yaml',
]);

/** Report categories and line numbers without echoing private matched text. */
export function inspectPrivacy(text, { home = homedir(), username = userInfo().username } = {}) {
  const checks = [
    ['absolute home path', /(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])[^\s"'<>]+/i],
  ];
  const personalName = username.length > 3 && !['root', 'admin', 'user', 'runner'].includes(username);
  const findings = [];
  for (const [index, line] of text.split('\n').entries()) {
    const categories = checks.filter(([, pattern]) => pattern.test(line)).map(([label]) => label);
    if (home && line.includes(home)) categories.push('current home directory');
    if (personalName && line.toLowerCase().includes(username.toLowerCase()))
      categories.push('current personal username');
    if (categories.length) findings.push({ line: index + 1, categories: [...new Set(categories)] });
  }
  return findings;
}

export async function auditPrivacy(root = projectRoot, { assets = false, identity } = {}) {
  const findings = [];
  let scannedFiles = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const path = resolve(directory, entry.name);
      const name = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name) || (!assets && name === 'web/public/assets')) continue;
        await visit(path);
      } else if (entry.isSymbolicLink()) {
        findings.push({ file: name, line: 0, categories: ['symlink requires explicit review'] });
      } else if (textExtensions.has(extname(path)) || entry.name.startsWith('.')) {
        scannedFiles++;
        for (const finding of inspectPrivacy(await readFile(path, 'utf8'), identity))
          findings.push({ file: name, ...finding });
      }
    }
  }
  await visit(resolve(root));
  return { scannedFiles, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--assets')) {
    console.error('Usage: node tools/audit-privacy.mjs [--assets]');
    process.exitCode = 1;
  } else {
    const result = await auditPrivacy(projectRoot, { assets: args.includes('--assets') });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.findings.length ? 1 : 0;
  }
}
