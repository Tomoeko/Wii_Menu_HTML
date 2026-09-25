import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const titleId = /^[0-9a-f]{16}$/;
const maximumProcessOutput = 1024 * 1024;

function localPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) {
    throw new Error(`Enter a valid local ${label} path.`);
  }
  return value.trim();
}

function selectedIds(value, label) {
  if (!Array.isArray(value) || value.length > 256 ||
      value.some((id) => typeof id !== 'string' || !titleId.test(id)) ||
      new Set(value).size !== value.length) {
    throw new Error(`Choose valid, unique ${label} channel IDs.`);
  }
  return value;
}

async function python(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python3', argumentsList, {
      cwd: project,
      timeout: 10 * 60 * 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let diagnostics = '';
    let exceeded = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > maximumProcessOutput) {
        exceeded = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk;
      if (diagnostics.length > maximumProcessOutput) {
        exceeded = true;
        child.kill();
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (exceeded) reject(new Error('NAND comparison produced too much output.'));
      else if (code !== 0) {
        reject(new Error(diagnostics.trim() || 'NAND comparison failed.'));
      } else resolve(output);
    });
  });
}

function validatePlan(plan, catalog) {
  if (!plan || !Array.isArray(plan.rows) || plan.rows.length > 256 ||
      !catalog || !Array.isArray(catalog.channels)) {
    throw new Error('The NAND comparison returned invalid channel data.');
  }
  const incoming = new Map(catalog.channels.map((channel) => [channel.id, channel]));
  if (incoming.size !== catalog.channels.length || incoming.size !== plan.rows.length) {
    throw new Error('The NAND preview and comparison contain different channels.');
  }
  for (const row of plan.rows) {
    if (!titleId.test(row.id) || !incoming.has(row.id) ||
        row.incomingSha256 !== incoming.get(row.id).source?.sha256) {
      throw new Error('The NAND changed while its channel preview was being prepared.');
    }
  }
  return plan;
}

/** Owns one ephemeral, local comparison so an Apply action targets the reviewed NAND. */
export function createChannelUpdateService(paths, { executePython = python } = {}) {
  const previewRoot = join(paths.assets, 'channel-updates');
  let session = null;

  return {
    async initialize() {
      // Preview exports are generated and ignored. A new server process has no
      // matching session, so old exports must not remain navigable as a choice.
      await rm(previewRoot, { recursive: true, force: true });
      await mkdir(previewRoot, { recursive: true });
    },
    async scan(value) {
      const nandPath = localPath(value.nandPath, 'NAND');
      const nandKeysPath = value.nandKeysPath === undefined
        ? null : localPath(value.nandKeysPath, 'NAND keys');
      const sessionId = randomUUID();
      const staging = join(previewRoot, `.staging-${sessionId}`);
      const preview = join(previewRoot, sessionId);
      const keys = nandKeysPath ? ['--nand-keys', nandKeysPath] : [];
      try {
        const response = await executePython([
          join(project, 'tools/assets/preview_nand_updates.py'),
          '--nand', nandPath,
          '--output', staging,
          '--scratch', paths.localDirectory,
          '--assets', paths.assets,
          ...keys,
        ]);
        const plan = validatePlan(
          JSON.parse(response),
          JSON.parse(await readFile(join(staging, 'channels.json'), 'utf8')),
        );
        await rename(staging, preview);
        const previous = session;
        session = { sessionId, nandPath, nandKeysPath, plan };
        if (previous) {
          await rm(join(previewRoot, previous.sessionId), {
            recursive: true,
            force: true,
          }).catch(() => {});
        }
        return {
          sessionId,
          rows: plan.rows,
          counts: {
            existing: plan.rows.filter((row) => row.installed).length,
            new: plan.rows.filter((row) => row.change === 'new').length,
            removed: plan.rows.filter((row) => row.change === 'removed').length,
          },
        };
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    },
    async apply(value) {
      if (!session || value.sessionId !== session.sessionId) {
        throw new Error('This NAND comparison has expired. Scan the NAND again.');
      }
      const replaceIds = selectedIds(value.replaceIds, 'replacement');
      const installNewIds = selectedIds(value.installNewIds, 'new');
      const rows = new Map(session.plan.rows.map((row) => [row.id, row]));
      if (replaceIds.some((id) => !rows.get(id) ||
          (!rows.get(id).installed && rows.get(id).change !== 'removed')) ||
          installNewIds.some((id) => rows.get(id)?.change !== 'new')) {
        throw new Error('The chosen channels do not match this NAND comparison.');
      }
      const keepIds = session.plan.rows
        .filter((row) => row.change === 'new' && !installNewIds.includes(row.id))
        .map((row) => row.id);
      const planFile = join(paths.localDirectory, `.channel-update-plan-${session.sessionId}.json`);
      try {
        await writeFile(planFile, JSON.stringify(session.plan), { flag: 'wx', mode: 0o600 });
        const argumentsList = [
          join(project, 'tools/assets/prepare.py'),
          'add', '--nand', session.nandPath,
          '--local-dir', paths.localDirectory,
          '--output', paths.assets,
          '--expect-plan', planFile,
        ];
        if (session.nandKeysPath) argumentsList.push('--nand-keys', session.nandKeysPath);
        for (const id of replaceIds) argumentsList.push('--replace-channel', id);
        for (const id of keepIds) argumentsList.push('--keep-channel', id);
        await executePython(argumentsList);
        const completed = session;
        session = null;
        await rm(join(previewRoot, completed.sessionId), {
          recursive: true,
          force: true,
        }).catch(() => {});
        return { replacedIds: replaceIds, addedIds: installNewIds, reloadRequired: true };
      } finally {
        await rm(planFile, { force: true }).catch(() => {});
      }
    },
  };
}
