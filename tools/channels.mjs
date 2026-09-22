#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  addCustomChannel,
  initializeCustomChannel,
  readCustomPackage,
  removeCustomChannel,
} from './custom-channels.mjs';
import {
  describeDeletedChannels,
  readChannelTrash,
  readInstalledChannelCatalog,
} from './channel-recovery.mjs';
import { selectChannelCatalog, validateChannelEnabled } from '../web/src/channel-selection.js';
import { planChannelSlots } from '../web/src/channel-storage.js';
import { readArrangement } from './local-state.mjs';
import { readConfiguration, updateConfiguration } from './configuration.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const defaults = {
  assets: join(project, 'web/public/assets'),
  configFile: join(project, 'config.json'),
  layoutFile: join(project, '.local/channel-layout.json'),
  localDirectory: join(project, '.local'),
};
const format = (value) => JSON.stringify(value, null, 2) + '\n';

export async function readChannelInventory(options = {}) {
  const paths = { ...defaults, ...options };
  const catalog = await readInstalledChannelCatalog(paths.assets);
  const trash = await readChannelTrash(paths);
  const deletedIds = trash.deleted.map((record) => record.id);
  const deleted = new Set(deletedIds);
  const configuration = await readConfiguration(paths.configFile);
  const selection = selectChannelCatalog(catalog, configuration.channels?.enabled, { deletedIds });
  const selected = new Set(selection.defaultOrder);
  const channels = [];
  for (const channel of catalog.channels) {
    const missing = [];
    for (const kind of ['iconLayout', 'bannerLayout']) {
      const resource = channel[kind];
      if (
        typeof resource !== 'string' ||
        !resource ||
        !(await stat(join(paths.assets, resource)).catch(() => null))?.isFile()
      ) {
        missing.push(kind);
      }
    }
    channels.push({ ...channel, missing });
  }
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const available = selection.defaultOrder
    .map((id) => byId.get(id))
    .filter((channel) => !channel.missing.length);
  const nativeIds = available
    .filter((channel) => !channel.custom)
    .map((channel) => channel.id);
  const arrangement = await readArrangement(paths.layoutFile);
  const defaultIds = catalog.savedLayout?.slots?.map((slot) => slot?.id ?? null) ?? [
    'disc',
    ...selection.defaultOrder,
  ];
  const plan = planChannelSlots(
    [{ id: 'disc', title: 'Disc Channel' }, ...available],
    arrangement,
    defaultIds,
    { priorityIds: nativeIds },
  );
  const slots = new Map(
    plan.slots.flatMap((channel, index) => (channel ? [[channel.id, index]] : [])),
  );
  return {
    channels: [
      {
        id: 'disc',
        title: 'Disc Channel',
        source: 'system-menu',
        enabled: true,
        slot: 0,
        status: 'visible',
      },
      ...channels
        .filter((channel) => !deleted.has(channel.id))
        .map((channel) => ({
          id: channel.id,
          title: channel.title,
          source: channel.custom ? 'custom' : 'imported',
          enabled: selected.has(channel.id),
          slot: slots.get(channel.id) ?? null,
          status: !selected.has(channel.id)
            ? 'disabled'
            : channel.missing.length
              ? 'missing-resources'
              : slots.has(channel.id)
                ? 'visible'
                : 'unplaced',
          ...(channel.missing.length ? { missing: channel.missing } : {}),
        })),
    ],
    unknownIds: selection.unknownIds,
    overflow: plan.overflow,
    deletedIds,
    deleted: await describeDeletedChannels(trash, catalog, paths.assets),
  };
}

/** Writes only visibility overrides; other configuration and catalog data stay intact. */
export async function setChannelEnabled(id, enabled, options = {}) {
  if (![true, false, null].includes(enabled)) throw new Error('Expected true, false or null.');
  const paths = { ...defaults, ...options };
  const inventory = await readChannelInventory(paths);
  if (inventory.deletedIds.includes(id)) {
    throw new Error('This channel is in Trash. Restore it before changing visibility.');
  }
  if (
    !inventory.channels.some((channel) => channel.id === id) &&
    !(enabled === null && inventory.unknownIds.includes(id))
  )
    throw new Error(`Channel is not installed: ${id}`);
  if (id === 'disc' && enabled === false) throw new Error('The Disc Channel cannot be disabled.');
  await updateConfiguration(paths.configFile, (configuration) => {
    const overrides = validateChannelEnabled(configuration.channels?.enabled);
    if (enabled === null) delete overrides[id];
    else overrides[id] = enabled;
    configuration.channels = {
      ...configuration.channels,
      enabled: validateChannelEnabled(overrides),
    };
  });
  return (
    (await readChannelInventory(paths)).channels.find((channel) => channel.id === id) ?? {
      id,
      status: 'not-installed',
      overrideRemoved: true,
    }
  );
}

function prepare(argumentsList) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.env.PYTHON || 'python3',
      [join(project, 'tools/assets/prepare.py'), ...argumentsList],
      { stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`WAD preparation failed (${signal ?? code}).`));
    });
  });
}

const help = `Channel management (local files only)

  npm run channels -- init <new-folder> [--id custom-example] [--title "My Channel"]
  npm run channels -- validate <folder>
  npm run channels -- add <folder-or-channel.wad> [--common-key-file <file>]
  npm run channels -- add --wad <channel.wad> [--common-key-file <file>]
  npm run channels -- install <folder> [<folder> ...]
  npm run channels -- list
  npm run channels -- enable <id>
  npm run channels -- disable <id>
  npm run channels -- reset <id>
  npm run channels -- remove <id-or-folder> [<id-or-folder> ...]

init writes animated icon/banner layouts and an original synthesized sound.wav.
Enable/disable changes config.json only; reset restores that ID's catalog default.
Install accepts authored folders and can install several in one command. Remove
accepts IDs or authored folders and keeps all supplied source files.
Remove uninstalls the local entry but keeps the source WAD or authoring folder.
Reload the menu after changes. Disc cannot be disabled or removed.

Isolated paths: --assets <folder> --config <file> --layout <file> --local-dir <folder>
WAD options: --common-key-file <file> --common-key-index <number>
`;

export async function runChannelCommand(args) {
  const [command, ...rest] = args;
  if (!command || ['--help', 'help'].includes(command)) return help;
  if (
    ![
      'init',
      'validate',
      'add',
      'install',
      'list',
      'enable',
      'disable',
      'reset',
      'remove',
    ].includes(command)
  ) {
    throw new Error(`Unknown channel command: ${command}`);
  }
  const options = {};
  const positional = [];
  const allowed = [
    'assets',
    'config',
    'layout',
    'local-dir',
    'id',
    'title',
    'wad',
    'common-key-file',
    'common-key-index',
  ];
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (!argument.startsWith('--')) positional.push(argument);
    else {
      const name = argument.slice(2);
      if (
        !allowed.includes(name) ||
        !rest[index + 1] ||
        rest[index + 1].startsWith('--') ||
        Object.hasOwn(options, name)
      ) {
        throw new Error(`Invalid or repeated option: ${argument}`);
      }
      options[name] = rest[++index];
    }
  }
  if (options.wad && command === 'add' && positional.length === 0) positional.push(options.wad);
  else if (options.wad)
    throw new Error('--wad is only supported by add without a positional path.');
  const acceptsMany = command === 'install' || command === 'remove';
  if (command === 'list' ? positional.length !== 0 : acceptsMany
    ? positional.length < 1
    : positional.length !== 1) {
    throw new Error(help);
  }
  const commandOptions = {
    init: ['id', 'title'],
    validate: [],
    add: ['assets', 'local-dir', 'wad', 'common-key-file', 'common-key-index'],
    install: ['assets', 'local-dir'],
    list: ['assets', 'config', 'layout'],
    enable: ['assets', 'config', 'layout'],
    disable: ['assets', 'config', 'layout'],
    reset: ['assets', 'config', 'layout'],
    remove: ['assets', 'config', 'layout', 'local-dir'],
  };
  for (const name of Object.keys(options)) {
    if (!commandOptions[command].includes(name))
      throw new Error(`--${name} is not supported by ${command}.`);
  }
  const paths = { ...defaults };
  for (const [option, key] of [
    ['assets', 'assets'],
    ['config', 'configFile'],
    ['layout', 'layoutFile'],
    ['local-dir', 'localDirectory'],
  ]) {
    if (options[option]) paths[key] = resolve(options[option]);
  }
  if (command === 'list') return readChannelInventory(paths);
  if (command === 'init')
    return initializeCustomChannel(positional[0], { id: options.id, title: options.title });
  if (command === 'validate') {
    const result = await readCustomPackage(positional[0]);
    return { id: result.manifest.id, valid: true, audio: result.audio, sha256: result.sha256 };
  }
  if (['enable', 'disable', 'reset'].includes(command)) {
    const enabled = command === 'reset' ? null : command === 'enable';
    return setChannelEnabled(positional[0], enabled, paths);
  }
  if (command === 'install') {
    const sources = [];
    const installed = [];
    const requestedIds = new Set();
    for (const folder of positional) {
      const source = resolve(folder);
      if (!(await stat(source).catch(() => null))?.isDirectory()) {
        throw new Error(`Install expects an authored channel folder: ${folder}`);
      }
      const prepared = await readCustomPackage(source);
      if (requestedIds.has(prepared.manifest.id)) {
        throw new Error(`The install list contains duplicate channel ID: ${prepared.manifest.id}`);
      }
      requestedIds.add(prepared.manifest.id);
      sources.push(source);
    }
    for (const source of sources) {
      installed.push(
        await addCustomChannel(source, paths.assets, {
          localDirectory: paths.localDirectory,
        }),
      );
    }
    return { installed };
  }
  if (command === 'remove') {
    const requests = [];
    const requestedIds = new Set();
    for (const target of positional) {
      let id = target;
      const source = resolve(target);
      if ((await stat(source).catch(() => null))?.isDirectory()) {
        id = (await readCustomPackage(source)).manifest.id;
      }
      if (requestedIds.has(id)) {
        throw new Error(`The remove list contains duplicate channel ID: ${id}`);
      }
      requestedIds.add(id);
      requests.push(id);
    }
    const inventory = await readChannelInventory(paths);
    const channels = new Map(inventory.channels.map((channel) => [channel.id, channel]));
    for (const id of requests) {
      if (id === 'disc') throw new Error('The Disc Channel cannot be removed.');
      if (!channels.has(id)) throw new Error(`Channel is not installed: ${id}`);
    }
    const removed = [];
    for (const id of requests) {
      const channel = channels.get(id);
      if (channel.source === 'custom') {
        removed.push(
          await removeCustomChannel(id, paths.assets, {
            localDirectory: paths.localDirectory,
          }),
        );
      } else {
        await prepare([
          'remove',
          id,
          '--local-dir',
          paths.localDirectory,
          '--output',
          paths.assets,
        ]);
        removed.push({ id, removed: true });
      }
    }
    return removed.length === 1 ? removed[0] : { removed };
  }
  const source = resolve(positional[0]);
  if ((await stat(source)).isDirectory()) {
    if (options.wad || options['common-key-file'] || options['common-key-index']) {
      throw new Error('WAD/key options cannot be used with an authored channel folder.');
    }
    return addCustomChannel(source, paths.assets, { localDirectory: paths.localDirectory });
  }
  const nativeArguments = [
    'add',
    '--wad',
    source,
    '--local-dir',
    paths.localDirectory,
    '--output',
    paths.assets,
  ];
  for (const name of ['common-key-file', 'common-key-index']) {
    if (options[name]) nativeArguments.push(`--${name}`, options[name]);
  }
  await prepare(nativeArguments);
  return { imported: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runChannelCommand(process.argv.slice(2))
    .then((result) => {
      console.log(typeof result === 'string' ? result : format(result).trimEnd());
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
