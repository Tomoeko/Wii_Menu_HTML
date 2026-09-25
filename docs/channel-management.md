# Channel visibility and saved placement

## Channel Manager

Run `npm start`, then open
[Channel Manager](http://127.0.0.1:5173/channels.html). Each installed channel shows
its source, visibility and page/tile position. **Hide** removes it from the grid
without uninstalling it; **Show** makes it available again. Disc is always fixed
in the first slot. Channels without prepared resources and channels awaiting an
available slot are reported explicitly.

**Install example channel** adds the original animated example with its sample
melody. **Create a channel** builds a separate editable package from a name,
colors and optional PNG/JPEG/GIF artwork and WAV files. **Preview** shows the menu icon and inside
animation using the menu renderer, with a Replay button for sound. See the
[authoring guide](custom-channels.md) for custom layouts and animation curves.
Existing authored folders can be installed through **Import and install**. WAD
imports continue to use the preparation command below.

**Compare NAND channels** scans a local extracted NAND directory or BootMii dump.
An optional path to `keys.bin` supports dumps without an embedded key footer.
Choose a title to see the currently installed and incoming animated icon and
banner side by side. TMD title versions and short SHA-256 identifiers help
distinguish copies. These previews are local and silent; a missing version is
shown as unavailable rather than inferred from the artwork. Existing and
previously removed titles default to **Keep**; new titles default to **Install**.
Choose **Replace** or **Restore from incoming NAND** explicitly, then review the
selection count and apply it. Scanning does not install anything. If either NAND
or the installed set changes before Apply, the operation fails and asks for a
new scan. Reload the Wii Menu after applying selected updates.

Changes take effect when the Wii Menu is reloaded. The manager updates the same
`config.json` visibility overrides as the CLI. It keeps imported resources and
custom source packages, so hiding a channel is reversible. It runs through the
local Node server; a static copy of the HTML cannot save these changes.

## Recoverable deletion

**Delete** moves a channel from the installed list into **Trash**. Open Trash and
choose **Restore** to bring it back. This applies to original imported channels
and custom packages. Disc cannot be deleted. Deletion preserves the catalog,
source packages, imported resources, visibility overrides and saved arrangement.
It writes only versioned tombstones in ignored `.local/channel-trash.json`.

Restoration keeps the previous Show/Hide choice and tries the remembered slot.
An occupied slot is never overwritten; a full menu leaves the channel installed
but unplaced. Duplicate requests are safe. If resources were removed or the ID
now refers to another source, Restore is disabled with an explanation and the
Trash entry remains available. Restore the original resources before retrying.

**Permanently Delete** removes a trashed channel after the existing confirmation
dialog. It removes that channel's managed authoring/import cache, generated
resources, catalog entry, visibility override and remembered positions. Supplied
WADs, external extracted NANDs and resources still referenced by another channel
are preserved. Disc and the System Menu title are protected. A conflicting
replacement under the same ID, symlinked managed paths, malformed metadata or a
busy import causes deletion to fail while preserving the Trash entry.

Permanent deletion first records a private recovery journal and moves owned
resources into quarantine beside their original locations. Metadata publication
removes the Trash entry last. A handled failure restores the original metadata
bytes and resources. On the next Channel Manager startup, an interrupted
uncommitted deletion rolls back; an already committed deletion completes its
quarantine cleanup. Process-termination tests cover both states. The journal is
`.local/channel-purge.json`; keep it and matching `.purge-*` resource folders
together until recovery finishes. These guarantees cover process interruption;
they do not claim atomic durability across filesystem or hardware power failure.

Trash is part of the local server's state. A static copy of the prepared menu has
no access to `.local` and does not apply that server's deletions. Back up
`.local/channel-trash.json` together with configuration and arrangement files.

## Command line

The same local command manages imported WAD channels and authored channel
packages. Run it from the project directory:

```sh
npm run channels -- list
npm run channels -- add /path/to/channel.wad
npm run channels -- add /path/to/authored-channel
npm run channels -- install /path/to/channel-one /path/to/channel-two
npm run channels -- overwrite /path/to/channel-one /path/to/channel-two
npm run channels -- disable custom-my-channel
npm run channels -- enable custom-my-channel
npm run channels -- reset custom-my-channel
npm run channels -- remove custom-my-channel /path/to/channel-two
npm run channels -- nand-plan /path/to/newer-nand
npm run channels -- nand-import /path/to/newer-nand --replace-channel 0001000148414241
```

WAD import delegates to the normal preparation command and accepts its optional
`--common-key-file` and `--common-key-index` overrides. It validates imported
contents before preparing resources. Authored folders use the declarative
[custom-channel format](custom-channels.md). The CLI `remove` command uninstalls its local catalog entry; it never deletes
the supplied WAD or authoring folder. Use Channel Manager Delete for the normal
Trash/Restore workflow. A CLI-uninstalled title must be reimported to return.
Disc stays in slot zero and cannot be hidden or removed.

`install` accepts multiple authored folders and refuses an already installed ID.
`overwrite` accepts multiple authored folders and explicitly replaces those
custom installations. `remove` accepts multiple installed IDs or authored
folders; folders are read for their manifest ID before removal.
`nand-plan` inspects one NAND without installing it. `nand-import` keeps installed
IDs by default; use repeatable `--replace-channel ID` and `--keep-channel ID`
for explicit choices, or `--nand-policy replace` for a bulk replacement with
individual keep overrides. `--keep-channel` can also skip a new channel. Supply
`--nand-keys FILE` for a raw dump that requires separate keys. The underlying
`prepare.py add` command accepts `--expect-plan FILE` to reject a stale reviewed
selection. These commands change local prepared resources, not the supplied NAND.
Prepared NAND channels stay ahead of custom channels in the catalog. When a NAND
save layout becomes available after custom installation, newly introduced NAND
titles reclaim their saved native slots first and custom titles fill the remaining
slots.

`list` prints each ID, title, source, enabled state, zero-based visible slot and
status. Status is `visible`, `disabled`, `missing-resources` or `unplaced`.
Missing layout files are reported separately. Unknown configuration IDs appear
in `unknownIds`, so a stale removed ID can be distinguished from an installed one.

## Simple on/off configuration

The CLI updates only `channels.enabled` in `config.json`, preserving unrelated
settings. You may also edit the same object directly:

```json
{
  "channels": {
    "persistLayout": true,
    "enabled": {
      "custom-my-channel": false,
      "0001000148414241": true
    }
  }
}
```

Use IDs from `list`; the hexadecimal ID above is only an example. Omitted IDs
follow the prepared catalog's default selection. A `true` override can enable an
installed title omitted from that default arrangement. `false` hides a title
without uninstalling its resources. `reset ID` removes an override, including
one left behind after uninstalling a title. Enabling an unknown ID is rejected;
unknown IDs already in an edited configuration are reported and ignored.

Reload after catalog or visibility changes. A reload cancels an in-progress grab
and uses the last completed saved arrangement. Configuration and imports do not
change underneath an active drag.

## Re-enabling and full menus

The menu has 48 unique visible slots including Disc. Existing visible slot
owners take priority. A newly enabled or reimported title returns to its remembered
slot if free; otherwise it takes the first free slot. A title never displaces or
overlaps an existing owner. When all slots are occupied, additional enabled
channels remain installed but unplaced. Disabling/removing a visible channel
makes a slot available for the next unplaced title.

`.local/channel-layout.json` remains version 1. Its `slots` array stores the last
visible arrangement, and optional `positions` remembers preferred slots for
visible, disabled, removed and unplaced IDs. Old files without `positions` remain
supported. Different inactive IDs may remember the same position; preferences do
not reserve a tile. The resolver assigns exactly one visible owner per slot.
Moving a channel into a disabled title's old location is valid; the active owner
keeps it when that title is re-enabled.

Back up both `config.json` and `.local/channel-layout.json`, along with your custom
source folders and imported WADs. Configuration and arrangement writes validate
before mutation and use atomic rename. Invalid configuration/catalog/placement
objects are rejected without replacing saved state. Simultaneous arrangement
writes are serialized in request order. The CLI uses an exclusive configuration
lock; if a crashed command leaves `<config>.channels.lock`, verify no command is
running before removing that empty lock directory.

For isolated development, use `--assets`, `--config` and `--layout` with list and
visibility commands. WAD add/remove additionally support `--local-dir`. Automated
tests use temporary directories and leave the installed catalog untouched.

## Runtime API

The local server exposes `GET /api/channels` for inventory and
`PUT /api/channels/<id>/enabled` with `{ "enabled": true }`, `false`, or `null`
to set or clear a visibility override. Creation uses `POST /api/channels/custom`,
the bundled example uses `POST /api/channels/example`, and authored-folder upload
uses `POST /api/channels/import`. Successful mutations return the current inventory
and `reloadRequired: true`. Mutation requests must originate from the served local
page. `POST /api/channels/<id>/delete` and `POST /api/channels/<id>/restore`, each
with an empty JSON object, manage recoverable deletion. Inventory includes active
`channels`, `deletedIds` and detailed `deleted` records with restoration status.
`POST /api/channels/<id>/purge` permanently deletes an already trashed channel
through the validated recovery transaction. It uses the same origin and JSON
requirements as other mutations.

`selectChannelCatalog(catalog, enabled, { deletedIds })` selects ordered metadata and reports
unknown override IDs. `planChannelSlots(channels, savedState, defaultIds)` returns
48 visible slots, unplaced IDs and remembered preferences. `readChannelPlacement`
loads the full versioned state; `serializeChannelPlacement` and
`saveChannelArrangement(slots, previousState)` retain inactive preferences during
ordinary moves. The host reports missing resources/overflow and owns loading,
rendering and gesture cancellation.

## September 2026 regression corrections

Storage focus now keeps an independent animation clock for every block. A rapid
pointer sweep previously committed a partial rollout and then discarded its
clock, leaving old blocks enlarged. The shared focus controller lets each clip
finish and queues the latest enter/leave request. The USA 4.3 `AnmPane` command
handler at `0x813A6F64` confirms independent pending focus commands and completion
handling; Options uses the same helper to prevent reported re-entry resets.
Exact rapid-reversal timing in Options still needs native capture acceptance.

The Wii/SD and Slot A/B tab rollout has a separate playback-direction correction.
Their `SelectWiiFoucusOut` and `SelectSdOut` resources contain the same ascending
1.0-to-1.1 scale keys as their entrance resources. Native ChannelEdit initialization
at `0x813A3864` marks animation indices 4 and 7 as reverse; Wii Memory at
`0x813C6E84` does the same for indices 5 and 8, and GameCube MemoryCard at
`0x813C9F68` for indices 7 and 10. The shared controller at `0x81362870` starts
reverse mode at the end frame, and `0x81362890` subtracts each update. The browser
now preserves that direction instead of enlarging the tab again on departure.
Regressions cover both tab selections in all three scenes, leaving for blank
space, the selected tab or Back, brief entry/exit, and selection during focus.

The Channels scene now binds its hit target to `B_Data_01` in widescreen and
`B_Data_00` in standard aspect. The previous unconditional standard-aspect target
was under a hidden parent in widescreen, preventing hover dispatch entirely.
The Wii tab now lists loaded installed/custom channel icons (Disc excluded), with
paging, channel title balloons and local detail presentation. A separate SD list
can be supplied by the storage fixture. Detail operations remain local fixtures:
confirmation reports `changed: false` and never removes installed files.

Thumbnail scale comes from the original aspect-specific `N_Atari` and focus
panes. ChannelEdit's `ChanAppBox::calc` and draw code indicate the separate
thumbnail/mask pass. The current page switch uses resource-derived block exit and
entry clips; native horizontal page motion, final mask pass, channel-specific
detail layout and capacity accounting remain open. Explicit populated SD
fixtures and readable page/tab persistence are implemented; see
[storage fixtures](storage-fixtures.md) for mapping, error cases and limits.
Regression tests cover sweeps, re-entry, both aspect hit branches, more than one
page, SD isolation and correct title identity. Browser checks confirm installed
icons and pagination are reachable without console errors; those checks are not
full-frame native acceptance.
