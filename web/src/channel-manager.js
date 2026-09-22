import { inspectImageHeader } from './image-format.js';

export const UPLOAD_LIMITS = Object.freeze({
  mediaBytes: 32 * 1024 * 1024,
  requestBytes: 56 * 1024 * 1024,
  jsonBytes: 2 * 1024 * 1024,
  imageDimension: 4096,
  files: 260,
  exampleAudioBytes: 44 + 32000 * 2.4 * 4,
});

const sourceLabels = { 'system-menu': 'Built-in', imported: 'Imported', custom: 'Custom' };
const statusLabels = {
  visible: 'Shown in menu',
  disabled: 'Hidden',
  'missing-resources': 'Missing files',
  unplaced: 'Waiting for a slot',
};

export function describeChannel(channel) {
  const position = Number.isInteger(channel.slot) && channel.slot >= 0 && channel.slot < 48;
  return {
    source: sourceLabels[channel.source] || 'Channel',
    status: statusLabels[channel.status] || 'Unavailable',
    position: position
      ? `Page ${Math.floor(channel.slot / 12) + 1} · Slot ${(channel.slot % 12) + 1}`
      : channel.enabled
        ? 'No available position'
        : 'Position remembered',
    fixed: channel.id === 'disc',
    canPreview:
      !channel.missing?.length && ['visible', 'disabled', 'unplaced'].includes(channel.status),
    previewUrl: `/channel-preview.html?channel=${encodeURIComponent(channel.id)}`,
  };
}

export function validateChannelDetails(title, background, accent) {
  const name = title.trim();
  if (!name || name.length > 80) throw new Error('Enter a channel name of 1–80 characters.');
  if (![background, accent].every((color) => /^#[0-9a-f]{6}$/i.test(color)))
    throw new Error('Choose a valid background and accent color.');
  return { title: name, colors: { background, accent } };
}

function byteView(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Fast checks precede image decoding and the server's package validation. */
export function validateImageBytes(input) {
  const { bytes } = byteView(input);
  const { width, height } = inspectImageHeader(bytes);
  if (bytes.length > UPLOAD_LIMITS.mediaBytes) throw new Error('This image exceeds 32 MiB.');
  return { width, height };
}

export function validateAudioBytes(input) {
  const { bytes, view } = byteView(input);
  const invalid = () => new Error('Choose a mono or stereo PCM WAV file, 8–192 kHz.');
  if (
    bytes.length < 44 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WAVE' ||
    view.getUint32(4, true) !== bytes.length - 8
  )
    throw invalid();
  let format;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) throw invalid();
    const type = ascii(bytes, offset, 4);
    if (type === 'fmt ' && length >= 16) {
      format = {
        encoding: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true),
        bits: view.getUint16(start + 14, true),
      };
    }
    if (type === 'data') dataBytes = length;
    offset = start + length + (length & 1);
  }
  if (
    !format ||
    !dataBytes ||
    format.encoding !== 1 ||
    ![1, 2].includes(format.channels) ||
    ![8, 16, 24, 32].includes(format.bits) ||
    format.sampleRate < 8000 ||
    format.sampleRate > 192000 ||
    format.blockAlign !== (format.channels * format.bits) / 8 ||
    format.byteRate !== format.sampleRate * format.blockAlign ||
    dataBytes % format.blockAlign !== 0
  )
    throw invalid();
  if (bytes.length > UPLOAD_LIMITS.mediaBytes) throw new Error('This WAV exceeds 32 MiB.');
  return { ...format, duration: dataBytes / format.byteRate };
}

export function validateMediaBudget(files, audioKind) {
  if (!['example', 'none', 'upload'].includes(audioKind))
    throw new Error('Choose a preview sound.');
  const total =
    files.reduce((sum, file) => sum + file.size, 0) +
    (audioKind === 'example' ? UPLOAD_LIMITS.exampleAudioBytes : 0);
  if (total > UPLOAD_LIMITS.mediaBytes)
    throw new Error('Artwork and sound together must fit within 32 MiB.');
  return total;
}

export function planFolderImport(inputFiles) {
  const files = [];
  const paths = new Set();
  const roots = new Set();
  let ignored = 0;
  for (const file of inputFiles) {
    const relative = file.webkitRelativePath || '';
    const parts = relative.split('/');
    if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..'))
      throw new Error('Select one channel folder with relative package paths.');
    roots.add(parts.shift());
    const path = parts.join('/');
    if (!/\.(json|png|jpe?g|gif|svg|wav|md)$/i.test(path)) {
      ignored++;
      continue;
    }
    if (path.length > 240 || !/^[A-Za-z0-9_./-]+$/.test(path))
      throw new Error('Package filenames must use letters, numbers, dots, dashes or underscores.');
    if (paths.has(path.toLowerCase())) throw new Error('The folder contains duplicate filenames.');
    paths.add(path.toLowerCase());
    if (/\.(json|md)$/i.test(path) && file.size > UPLOAD_LIMITS.jsonBytes)
      throw new Error('Each channel JSON or Markdown file must fit within 2 MiB.');
    if (file.size > UPLOAD_LIMITS.mediaBytes) throw new Error('A package file exceeds 32 MiB.');
    files.push({ path, file });
  }
  if (roots.size !== 1 || !files.some((entry) => entry.path === 'channel.json'))
    throw new Error('Choose a channel folder with channel.json at its top level.');
  if (files.length > UPLOAD_LIMITS.files)
    throw new Error('A channel folder can contain up to 260 supported files.');
  validateMediaBudget(
    files
      .filter(({ path }) => /\.(png|jpe?g|gif|svg|wav)$/i.test(path))
      .map(({ file }) => file),
    'none',
  );
  const requestBytes = files.reduce(
    (sum, { path, file }) => sum + Math.ceil(file.size / 3) * 4 + path.length + 64,
    32,
  );
  if (requestBytes > UPLOAD_LIMITS.requestBytes)
    throw new Error('This channel folder is too large to import in one request.');
  return { files, ignored };
}

function base64(bytes) {
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(pieces.join(''));
}

async function decodeImage(file) {
  try {
    if (typeof createImageBitmap === 'function') {
      const image = await createImageBitmap(file);
      image.close();
      return;
    }
  } catch {
    // Some browsers do not expose SVG decoding through createImageBitmap.
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch {
    throw new Error('This image cannot be decoded. Choose another PNG, JPEG, GIF, or SVG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function startChannelManager() {
  const element = (id) => document.getElementById(id);
  const createForm = element('create-form');
  const importForm = element('import-form');
  const list = element('channel-list');
  const feedback = element('feedback');
  const error = element('error');
  const uploadCache = new WeakMap();
  let inventory = null;
  let busy = false;
  let iconUrl = null;

  function node(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    feedback.textContent = '';
  }

  function setBusy(value) {
    busy = value;
    list.setAttribute('aria-busy', String(value));
    for (const control of document.querySelectorAll('button, input, select')) {
      const unusedAudio = control.id === 'audio-file' && element('audio-choice').value !== 'upload';
      control.disabled = value || control.dataset.fixed === 'true' || unusedAudio;
    }
    createForm.setAttribute('aria-busy', String(value));
    importForm.setAttribute('aria-busy', String(value));
  }

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        result?.error?.message || 'The channel could not be saved. Please try again.',
      );
    if (!result) throw new Error('The local server returned an invalid response.');
    return result;
  }

  function renderInventory(next) {
    if (!next || !Array.isArray(next.channels))
      throw new Error('The channel list is unavailable. Refresh to try again.');
    inventory = next;
    const titleCounts = new Map();
    for (const channel of next.channels)
      titleCounts.set(channel.title, (titleCounts.get(channel.title) || 0) + 1);
    list.replaceChildren();
    for (const channel of next.channels) {
      const details = describeChannel(channel);
      const repeatedTitle = titleCounts.get(channel.title) > 1;
      const actionTitle = repeatedTitle ? `${channel.title} (${channel.id})` : channel.title;
      const row = node('article', 'channel-row');
      const initials =
        channel.id === 'disc' ? '◉' : [...channel.title].slice(0, 2).join('').toUpperCase();
      const avatar = node('div', 'channel-avatar', initials);
      avatar.dataset.source = channel.source;
      avatar.setAttribute('aria-hidden', 'true');
      const information = node('div', 'channel-information');
      information.append(node('h3', '', channel.title));
      if (repeatedTitle) information.append(node('p', 'channel-identifier', channel.id));
      const metadata = node('p', 'channel-metadata');
      metadata.append(node('span', '', details.source), node('span', '', details.position));
      const badge = node('span', 'status-badge', details.status);
      badge.dataset.status = channel.status;
      information.append(metadata, badge);
      if (channel.missing?.length)
        information.append(
          node(
            'p',
            'channel-detail',
            `Missing ${channel.missing.join(' and ')}. Restore or re-import this channel's files to preview it.`,
          ),
        );
      else if (channel.status === 'unplaced')
        information.append(
          node(
            'p',
            'channel-detail',
            'Hide another channel to make room. Your files are installed.',
          ),
        );
      const actions = node('div', 'channel-actions');
      if (details.canPreview) {
        const preview = node('a', 'preview-link', 'Preview');
        preview.href = details.previewUrl;
        preview.setAttribute('aria-label', `Preview ${actionTitle}`);
        actions.append(preview);
      }
      const toggle = node(
        'button',
        'button button-secondary button-small',
        details.fixed ? 'Fixed' : channel.enabled ? 'Hide' : 'Show',
      );
      toggle.type = 'button';
      toggle.dataset.channelId = channel.id;
      toggle.dataset.fixed = String(details.fixed);
      toggle.disabled = busy || details.fixed;
      toggle.setAttribute(
        'aria-label',
        details.fixed
          ? 'Disc Channel is always shown'
          : `${channel.enabled ? 'Hide' : 'Show'} ${actionTitle}`,
      );
      toggle.addEventListener('click', () =>
        runAction(async () => {
          const result = await request(`/api/channels/${encodeURIComponent(channel.id)}/enabled`, {
            method: 'PUT',
            body: { enabled: !channel.enabled },
          });
          applySaved(result, `${channel.title} is now ${channel.enabled ? 'hidden' : 'enabled'}.`);
        }, 'Saving channel visibility…'),
      );
      actions.append(toggle);
      if (!details.fixed) {
        const remove = node('button', 'button button-danger button-small', 'Delete');
        remove.type = 'button';
        remove.dataset.channelId = channel.id;
        remove.setAttribute('aria-label', `Delete ${actionTitle}`);
        remove.title = 'Move to Trash. You can restore this channel below.';
        remove.addEventListener('click', () =>
          runAction(async () => {
            const result = await request(`/api/channels/${encodeURIComponent(channel.id)}/delete`, {
              method: 'POST',
              body: {},
            });
            applySaved(result, `Moved “${channel.title}” to Trash. Its files are retained.`);
            element('trash-panel').open = true;
          }, 'Moving channel to Trash…'),
        );
        actions.append(remove);
      }
      row.append(avatar, information, actions);
      list.append(row);
    }
    if (!next.channels.length)
      list.append(
        node('p', 'empty-state', 'No channels are installed yet. Create a channel to get started.'),
      );
    const visible = next.channels.filter((channel) => channel.status === 'visible').length;
    const hidden = next.channels.filter((channel) => !channel.enabled).length;
    const summary = element('inventory-summary');
    summary.replaceChildren();
    for (const [value, label] of [
      [next.channels.length, 'installed'],
      [visible, 'shown'],
      [hidden, 'hidden'],
    ]) {
      const item = node('span');
      item.append(node('strong', '', value), document.createTextNode(` ${label}`));
      summary.append(item);
    }
    const warnings = [];
    if (next.overflow?.length)
      warnings.push(`${next.overflow.length} channel(s) need an available slot.`);
    if (next.unknownIds?.length)
      warnings.push(
        `${next.unknownIds.length} saved visibility setting(s) refer to channels that are no longer installed.`,
      );
    const warning = element('inventory-warning');
    warning.textContent = warnings.join(' ');
    warning.hidden = !warnings.length;
    renderTrash(next.deleted ?? []);
  }

  function renderTrash(deleted) {
    const trash = element('trash-list');
    trash.replaceChildren();
    element('trash-count').textContent = String(deleted.length);
    const reasons = {
      'missing-source': 'The original channel is no longer installed. Re-import its source first.',
      'id-conflict': 'A different channel now uses this ID. Restore the original package first.',
      'missing-resources':
        'Some prepared files are missing. Rebuild or re-import them, then refresh.',
    };
    for (const channel of deleted) {
      const row = node('article', 'trash-row');
      const information = node('div', 'channel-information');
      information.append(node('h3', '', channel.title));
      information.append(node('p', 'channel-identifier', channel.id));
      const date = new Date(channel.deletedAt).toLocaleDateString();
      information.append(
        node('p', 'channel-metadata', `${sourceLabels[channel.source]} · Deleted ${date}`),
      );
      if (!channel.canRestore) {
        information.append(
          node(
            'p',
            'channel-detail',
            reasons[channel.restoreStatus] ||
              'Restore is unavailable. Refresh after checking the original files.',
          ),
        );
      }
      const actions = node('div', 'trash-actions');
      const restore = node('button', 'button button-secondary button-small', 'Restore');
      restore.type = 'button';
      restore.dataset.channelId = channel.id;
      restore.dataset.fixed = String(!channel.canRestore);
      restore.disabled = busy || !channel.canRestore;
      restore.setAttribute('aria-label', `Restore ${channel.title} (${channel.id})`);
      restore.addEventListener('click', () =>
        runAction(async () => {
          const result = await request(`/api/channels/${encodeURIComponent(channel.id)}/restore`, {
            method: 'POST',
            body: {},
          });
          applySaved(result, `Restored “${channel.title}”.`);
        }, 'Restoring channel…'),
      );
      const purge = node('button', 'button button-danger button-small', 'Permanently Delete');
      purge.type = 'button';
      purge.dataset.channelId = channel.id;
      purge.setAttribute(
        'aria-label',
        `Permanently delete ${channel.title} (${channel.id})`,
      );
      purge.title = 'Remove this channel and its files. This cannot be undone.';
      purge.addEventListener('click', () => {
        const confirmed = confirm(
          `Permanently delete “${channel.title}”?

` +
            'This removes the channel’s catalog entry, source files and saved ' +
            'references. This cannot be undone.',
        );
        if (!confirmed) return;
        runAction(async () => {
          const result = await request(
            `/api/channels/${encodeURIComponent(channel.id)}/purge`,
            { method: 'POST', body: {} },
          );
          applySaved(
            result,
            `Permanently deleted “${result.title}”. Its files have been removed.`,
          );
        }, 'Permanently deleting channel…');
      });
      actions.append(restore, purge);
      row.append(information, actions);
      trash.append(row);
    }
    if (!deleted.length) trash.append(node('p', 'empty-state', 'Trash is empty.'));
  }

  function applySaved(result, message) {
    renderInventory(result.inventory);
    element('saved-notice').hidden = false;
    const preview = element('saved-preview');
    preview.hidden = !result.channel?.id || !describeChannel(result.channel).canPreview;
    if (!preview.hidden) preview.href = describeChannel(result.channel).previewUrl;
    feedback.textContent = message;
    if (result.channel?.status === 'disabled')
      feedback.textContent += ' It is hidden; choose Show in the list to add it to the menu.';
    if (result.channel?.status === 'unplaced')
      feedback.textContent += ' It is waiting for a free slot. Hide another channel to make room.';
    if (result.channel?.status === 'deleted')
      feedback.textContent += ' It remains in Trash; choose Restore below to return it.';
    if (result.authoringDirectory)
      feedback.textContent += ` Editable files: ${result.authoringDirectory}.`;
  }

  async function runAction(action, message) {
    if (busy) return;
    const priorFocus = document.activeElement;
    const channelId = priorFocus?.dataset.channelId;
    error.hidden = true;
    feedback.textContent = message;
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      showError(failure.message || 'The local server could not be reached.');
    } finally {
      setBusy(false);
      const nextFocus = channelId
        ? [...document.querySelectorAll('.channel-list button, #trash-list button')].find(
            (button) => button.dataset.channelId === channelId,
          )
        : priorFocus;
      if (nextFocus?.isConnected) nextFocus.focus({ preventScroll: true });
    }
  }

  function readUpload(file, kind) {
    if (!file) return Promise.resolve(null);
    if (!uploadCache.has(file))
      uploadCache.set(
        file,
        (async () => {
          if (!file.size || file.size > UPLOAD_LIMITS.mediaBytes)
            throw new Error('Choose a nonempty file up to 32 MiB.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const metadata = kind === 'audio' ? validateAudioBytes(bytes) : validateImageBytes(bytes);
          if (kind !== 'audio') await decodeImage(file);
          return { bytes, metadata };
        })(),
      );
    return uploadCache.get(file);
  }

  function updateDesign() {
    const background = element('background-color').value;
    const accent = element('accent-color').value;
    element('design-title').textContent = element('channel-title').value.trim() || 'My Channel';
    element('background-label').value = background.toUpperCase();
    element('accent-label').value = accent.toUpperCase();
    element('design-tile').style.setProperty('--tile-background', background);
    element('design-tile').style.setProperty('--tile-accent', accent);
  }

  for (const id of ['channel-title', 'background-color', 'accent-color'])
    element(id).addEventListener('input', updateDesign);
  element('audio-choice').addEventListener('change', () => {
    element('audio-upload').hidden = element('audio-choice').value !== 'upload';
    element('audio-file').required = element('audio-choice').value === 'upload';
    element('audio-file').disabled = element('audio-choice').value !== 'upload';
  });
  for (const kind of ['icon', 'banner', 'audio']) {
    const input = element(`${kind}-file`);
    const clear = element(`clear-${kind}`);
    clear.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('change'));
      input.focus();
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      clear.hidden = !file;
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      element(`${kind}-details`).textContent = file ? 'Checking file…' : '';
      if (kind === 'icon') {
        if (iconUrl) URL.revokeObjectURL(iconUrl);
        iconUrl = null;
        element('icon-preview').hidden = true;
        element('icon-preview').removeAttribute('src');
      }
      try {
        const upload = await readUpload(file, kind);
        if (input.files[0] !== file || !upload) return;
        const { metadata } = upload;
        element(`${kind}-details`).textContent =
          kind === 'audio'
            ? `${metadata.duration.toFixed(1)} seconds · ${metadata.channels === 1 ? 'Mono' : 'Stereo'}`
            : `${metadata.width} × ${metadata.height} pixels`;
        if (kind === 'icon') {
          iconUrl = URL.createObjectURL(file);
          element('icon-preview').src = iconUrl;
          element('icon-preview').hidden = false;
        }
      } catch (failure) {
        if (input.files[0] !== file) return;
        input.setCustomValidity(failure.message);
        input.setAttribute('aria-invalid', 'true');
        element(`${kind}-details`).textContent = failure.message;
      }
    });
  }

  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runAction(async () => {
      const details = validateChannelDetails(
        element('channel-title').value,
        element('background-color').value,
        element('accent-color').value,
      );
      const audioKind = element('audio-choice').value;
      const files = {
        icon: element('icon-file').files[0],
        banner: element('banner-file').files[0],
        audio: audioKind === 'upload' ? element('audio-file').files[0] : null,
      };
      if (audioKind === 'upload' && !files.audio)
        throw new Error('Choose a WAV file for the preview sound.');
      validateMediaBudget(Object.values(files).filter(Boolean), audioKind);
      const uploads = await Promise.all(
        Object.entries(files).map(async ([kind, file]) => [kind, await readUpload(file, kind)]),
      );
      const body = { ...details, audio: { kind: audioKind } };
      for (const [kind, upload] of uploads) {
        if (!upload) continue;
        if (kind === 'audio') body.audio.base64 = base64(upload.bytes);
        else body[kind] = { base64: base64(upload.bytes) };
      }
      const result = await request('/api/channels/custom', { method: 'POST', body });
      applySaved(result, `Installed “${result.channel.title}”.`);
    }, 'Creating your channel…');
  });

  element('install-example').addEventListener('click', () =>
    runAction(async () => {
      const result = await request('/api/channels/example', { method: 'POST', body: {} });
      let message =
        'Example channel installed. Open its preview to see the animation and hear its melody.';
      if (result.installed === false) message = 'The example channel is already installed.';
      if (result.repaired)
        message = 'Example channel repaired. Its missing or damaged files have been restored.';
      applySaved(result, message);
    }, 'Installing the example channel…'),
  );

  element('folder-files').addEventListener('change', () => {
    const input = element('folder-files');
    input.setCustomValidity('');
    try {
      if (!input.files.length) {
        element('folder-details').textContent = '';
        return;
      }
      const plan = planFolderImport(input.files);
      element('folder-details').textContent =
        `${plan.files.length} package files selected${plan.ignored ? `; ${plan.ignored} unrelated file(s) ignored` : ''}.`;
    } catch (failure) {
      input.setCustomValidity(failure.message);
      element('folder-details').textContent = failure.message;
    }
  });
  importForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runAction(async () => {
      const plan = planFolderImport(element('folder-files').files);
      const files = [];
      for (const entry of plan.files) {
        let bytes;
        if (/\.(png|jpe?g|gif|svg|wav)$/i.test(entry.path))
          bytes = (await readUpload(entry.file, /\.wav$/i.test(entry.path) ? 'audio' : 'image'))
            .bytes;
        else bytes = new Uint8Array(await entry.file.arrayBuffer());
        if (/\.json$/i.test(entry.path)) {
          try {
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          } catch {
            throw new Error(`Invalid JSON in ${entry.path}.`);
          }
        }
        files.push({ path: entry.path, base64: base64(bytes) });
      }
      const result = await request('/api/channels/import', { method: 'POST', body: { files } });
      applySaved(result, `Imported “${result.channel.title}”.`);
    }, 'Checking and importing the channel folder…');
  });
  async function refresh() {
    await runAction(async () => {
      renderInventory(await request('/api/channels'));
      feedback.textContent = '';
    }, 'Loading your channels…');
    if (!inventory)
      list.replaceChildren(
        node(
          'p',
          'empty-state',
          'The channel list could not be loaded. Check the local server and use Refresh to try again.',
        ),
      );
  }
  element('refresh').addEventListener('click', refresh);
  window.addEventListener('pagehide', () => {
    if (iconUrl) URL.revokeObjectURL(iconUrl);
  });
  updateDesign();
  await refresh();
}

if (typeof document !== 'undefined') void startChannelManager();
