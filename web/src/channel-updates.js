import { candidateAssetBase } from './channel-update-preview.js';

function element(id) {
  return document.getElementById(id);
}

function node(tag, className, content) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}

function normalizeScan(result) {
  candidateAssetBase(result?.sessionId);
  if (!Array.isArray(result.rows)) {
    throw new Error('The local server returned an invalid channel comparison.');
  }
  const ids = new Set();
  const rows = result.rows.map((row) => {
    if (!row || !/^[0-9a-f]{16}$/i.test(row.id) || ids.has(row.id.toLowerCase())) {
      throw new Error('The local server returned an invalid channel comparison.');
    }
    ids.add(row.id.toLowerCase());
    return {
      ...row,
      id: row.id.toLowerCase(),
      title: typeof row.title === 'string' && row.title.trim() ? row.title : row.id,
      installed: Boolean(row.installed),
    };
  });
  return { sessionId: result.sessionId, rows };
}

function actionLabel(row) {
  if (row.change === 'removed') return 'Restore from incoming NAND';
  return row.installed ? 'Replace installed version' : 'Install new channel';
}

function changeLabel(row) {
  if (row.change === 'removed') return 'Previously removed';
  if (!row.installed) return 'New channel';
  if (row.change === 'unavailable') return 'Installed source unavailable';
  if (row.change === 'same') return 'Same content and version';
  return 'Different content or version';
}

function versionLabel(version, bannerHash, tmdHash) {
  const parts = [];
  if (typeof version === 'number' || (typeof version === 'string' && version.trim())) {
    parts.push(`Title version ${version}`);
  }
  if (typeof bannerHash === 'string' && /^[0-9a-f]{64}$/i.test(bannerHash)) {
    parts.push(`Banner SHA-256 ${bannerHash.slice(0, 12)}…`);
  }
  if (typeof tmdHash === 'string' && /^[0-9a-f]{64}$/i.test(tmdHash)) {
    parts.push(`TMD SHA-256 ${tmdHash.slice(0, 12)}…`);
  }
  return parts.join(' · ') || 'Version information unavailable';
}

export function planChannelUpdateSelection(rows, decisions) {
  const replaceIds = [];
  const installNewIds = [];
  for (const row of rows) {
    if (!decisions.get(row.id)) continue;
    if (row.installed || row.change === 'removed') replaceIds.push(row.id);
    else installNewIds.push(row.id);
  }
  return { replaceIds, installNewIds };
}

export function startChannelUpdates({ request, runAction, applySaved }) {
  const manageView = element('manage-view');
  const updatesView = element('updates-view');
  const manageButton = element('manage-view-button');
  const updatesButton = element('updates-view-button');
  const results = element('update-results');
  const list = element('update-list');
  const detail = element('update-detail');
  const decisions = new Map();
  let sessionId = null;
  let rows = [];
  let selectedId = null;

  function showView(name) {
    const updates = name === 'updates';
    manageView.hidden = updates;
    updatesView.hidden = !updates;
    manageButton.setAttribute('aria-pressed', String(!updates));
    updatesButton.setAttribute('aria-pressed', String(updates));
    if (!updates) {
      // Removing the iframes stops both preview animation loops while this view is hidden.
      detail.replaceChildren();
    } else if (sessionId && selectedId) {
      const selected = rows.find((row) => row.id === selectedId);
      if (selected) selectRow(selected);
    }
  }

  function updateFromHash() {
    showView(location.hash === '#updates' ? 'updates' : 'manage');
  }

  manageButton.addEventListener('click', () => {
    location.hash = 'manage';
    updateFromHash();
  });
  updatesButton.addEventListener('click', () => {
    location.hash = 'updates';
    updateFromHash();
  });
  window.addEventListener('hashchange', updateFromHash);
  updateFromHash();

  function selectionSummary() {
    const selection = planChannelUpdateSelection(rows, decisions);
    const replace = selection.replaceIds.length;
    const added = selection.installNewIds.length;
    element('update-selection-summary').textContent =
      `${replace} to replace or restore · ${added} new to install`;
    element('update-apply').dataset.inactive = String(!replace && !added);
    element('update-apply').disabled = !replace && !added;
    return selection;
  }

  function clearComparison() {
    results.hidden = true;
    sessionId = null;
    rows = [];
    selectedId = null;
    decisions.clear();
    list.replaceChildren();
    detail.replaceChildren();
    selectionSummary();
  }

  function selectRow(row) {
    selectedId = row.id;
    for (const entry of list.querySelectorAll('.update-row')) {
      entry.dataset.selected = String(entry.dataset.channelId === selectedId);
    }
    detail.replaceChildren();

    const heading = node('div', 'update-detail-heading');
    const headingText = node('div');
    headingText.append(node('h3', '', row.title), node('p', '', `Title ID ${row.id}`));
    const badge = node('span', 'update-change-badge', changeLabel(row));
    badge.dataset.change = row.change;
    heading.append(headingText, badge);
    detail.append(heading);

    const comparison = node('div', 'update-comparison');
    for (const source of ['installed', 'incoming']) {
      const card = node('section', 'update-source-card');
      card.append(node('h4', '', source === 'installed' ? 'Installed channel' : 'Incoming NAND'));
      const version = source === 'installed' ? row.existingVersion : row.incomingVersion;
      const hash = source === 'installed' ? row.existingSha256 : row.incomingSha256;
      const tmdHash = source === 'installed'
        ? row.existingTmdSha256
        : row.incomingTmdSha256;
      card.append(node('p', 'update-version', versionLabel(version, hash, tmdHash)));
      if (source === 'installed' && (!row.installed || row.change === 'removed')) {
        card.append(
          node(
            'div',
            'comparison-absent',
            row.change === 'removed'
              ? 'This title was previously removed from the local menu.'
              : 'This channel is not installed yet.',
          ),
        );
      } else {
        const frame = node('iframe', 'comparison-frame');
        const query = new URLSearchParams({ channel: row.id, compare: '1' });
        if (source === 'incoming') query.set('candidate', sessionId);
        frame.src = `/channel-preview.html?${query}`;
        const sourceLabel = source === 'installed' ? 'Installed' : 'Incoming';
        frame.title = `${sourceLabel} ${row.title} icon and banner`;
        card.append(frame);
      }
      comparison.append(card);
    }
    detail.append(comparison);
  }

  function renderList() {
    const search = element('update-filter').value.trim().toLowerCase();
    list.replaceChildren();
    const visible = rows.filter(
      (row) => row.title.toLowerCase().includes(search) || row.id.includes(search),
    );
    for (const row of visible) {
      const item = node('article', 'update-row');
      item.dataset.channelId = row.id;
      item.dataset.selected = String(row.id === selectedId);
      const choose = node('button', 'update-row-button');
      choose.type = 'button';
      choose.append(node('strong', '', row.title), node('span', '', row.id));
      choose.addEventListener('click', () => selectRow(row));
      const label = node('label', 'update-choice');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = decisions.get(row.id);
      checkbox.setAttribute('aria-label', `${actionLabel(row)}: ${row.title} (${row.id})`);
      checkbox.addEventListener('change', () => {
        decisions.set(row.id, checkbox.checked);
        selectionSummary();
      });
      label.append(checkbox, node('span', '', actionLabel(row)));
      item.append(choose, label);
      list.append(item);
    }
    if (!visible.length) {
      const message = rows.length ? 'No matching channels.' : 'No channels found.';
      list.append(node('p', 'empty-state', message));
      detail.replaceChildren(node('p', 'empty-state', message));
      selectedId = null;
    } else if (!visible.some((row) => row.id === selectedId)) {
      selectRow(visible[0]);
    }
  }

  element('update-filter').addEventListener('input', renderList);
  for (const id of ['nand-path', 'nand-keys-path']) {
    element(id).addEventListener('input', () => {
      if (!sessionId) return;
      clearComparison();
      element('feedback').textContent = 'The source path changed. Scan again to compare channels.';
    });
  }
  element('update-scan-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runAction(async () => {
      const nandPath = element('nand-path').value.trim();
      const nandKeysPath = element('nand-keys-path').value.trim();
      const body = { nandPath };
      if (nandKeysPath) body.nandKeysPath = nandKeysPath;
      const scan = normalizeScan(await request('/api/channels/updates/scan', {
        method: 'POST',
        body,
      }));
      sessionId = scan.sessionId;
      rows = scan.rows;
      selectedId = null;
      decisions.clear();
      for (const row of rows) decisions.set(row.id, !row.installed && row.change !== 'removed');
      const existing = rows.filter((row) => row.installed).length;
      const incoming = rows.length - existing;
      element('update-counts').textContent =
        `${existing} already installed · ${incoming} new or previously removed`;
      element('update-filter').value = '';
      results.hidden = false;
      renderList();
      selectionSummary();
      element('feedback').textContent = `Compared ${rows.length} channel(s) from the selected NAND.`;
    }, 'Scanning the NAND and preparing channel previews…');
  });

  element('update-rescan').addEventListener('click', () => {
    clearComparison();
    element('nand-path').focus();
  });

  element('update-apply').addEventListener('click', () => {
    if (!sessionId) return;
    const selection = selectionSummary();
    if (!selection.replaceIds.length && !selection.installNewIds.length) return;
    const confirmed = confirm(
      `Apply ${selection.replaceIds.length} replacement or restoration(s) and ` +
      `${selection.installNewIds.length} new installation(s)?`,
    );
    if (!confirmed) return;
    runAction(async () => {
      const result = await request('/api/channels/updates/apply', {
        method: 'POST',
        body: { sessionId, ...selection },
      });
      clearComparison();
      applySaved(
        result,
        `Updated ${result.replacedIds?.length || 0} existing channel(s) and ` +
          `installed ${result.addedIds?.length || 0} new channel(s).`,
      );
      location.hash = 'manage';
      updateFromHash();
      manageButton.focus();
    }, 'Applying selected channel changes…');
  });
}
