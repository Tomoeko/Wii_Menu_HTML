# Local SD and storage fixtures

SD page, completed Help status and each Data Management tab are stored in
`.local/storage-state.json`. Page numbers in this file are zero-based (0–19).
The three tab fields are `wii`, `channels` and `gamecube`; each accepts `wii` or
`sd`, with those values representing Slot A and Slot B for GameCube. State is
saved when a page scroll or tab transition completes. Reload restores it.
`helpSeen: null` migrates the prior browser-local welcome flag; completing Help
or a page change records a boolean in the readable file. Back up this file with
other `.local` state. Settings are shared by browser sessions using this server.

The server validates version 1, bounds and tab names, serializes saves, flushes a
new private file and renames it into place. A foreign lock, corrupt existing JSON
or a symlink is an error; corrupt state is retained for manual repair. The UI
shows a warning and uses defaults for that session. Failed saves also show a
warning. This small state writer does not claim hardware power-loss durability;
a killed process can leave its uniquely named `.tmp` file and `.lock` directory.
After stopping the server, inspect and remove only those storage-state scratch
paths before retrying. Channel preparation uses its separate durable journal.

## Select a deterministic medium

The optional, readable `.local/storage-fixture.json` supplies local media state.
Absent this file, SD is empty and ready, Wii shows the existing Dummy Save,
GameCube Slot A is empty and ready, and Slot B is absent. Read-only
`GET /api/storage-fixture` loads it; change the file and reload the browser to
select a different case. The fixture API never edits installed channels or save
data. Do not overwrite an existing personal fixture without making a backup.

Tracked, synthetic examples are in `examples/storage-fixtures/`:

| Example | Case |
| --- | --- |
| `populated.json` | Example Channel on SD page 2, one synthetic SD save, and 16 synthetic GameCube Slot B records to exercise a second page. |
| `absent.json` | SD and both GameCube slots absent. |
| `errors.json` | SD and Slot A read failures, Slot B unsupported. |

Copy one example to `.local/storage-fixture.json` in a disposable test copy, or
adapt its fields in your existing local fixture. Each medium's `status` accepts
`ready`, `absent`, `read-error` or `unsupported`. Wii/SD save and GameCube lists
accept at most 240 synthetic `{id, title, blocks}` records. IDs must be distinct
within that list; titles are bounded to 100 characters and block counts to
integers from 1 through 99999. These declared block counts are not measurements
of a device's capacity.

An optional top-level `freeBlocks` object declares the free capacity shown in
Data Management. For example, `"freeBlocks": {"wii": 905, "sd": 1007}` selects
those fixture values explicitly. Either field may be omitted. Wii accepts an
integer from 0 through 9999 and SD from 0 through 999999, matching the original
four- and six-digit display paths. A zero value is valid. Version 1 fixtures
without these fields remain valid and keep the existing 905-block default;
1007 is an example, not an assumed SD capacity. The same medium's declaration
is used by Channels and Wii Save Data. GameCube does not use this label.

The label is visible only for ready media. It combines original message 156,
the unpadded decimal count without thousands separators, and message 242. This
preserves languages whose block label follows the number. Counts are explicit
local test state; neither a NAND import nor channel block totals imply a
measured free-space value. Reading the fixture never rewrites it.

SD channel mappings are explicit `{id, slot}` references to already loaded,
enabled local channels. Slots are unique zero-based positions from 0 through
239, twelve per page; each ID may appear once and Disc is excluded. For example,
slot 13 means the second position on page 2. `populated.json` references the
tracked `custom-example` channel; install it through the Channel Manager if it
is not present. Prepared NAND and WAD imports appear in the installed Wii list;
importing a NAND does not imply that any channel is on an SD card. Add the exact
channel ID to the fixture to preview that installed artwork on SD. Unknown,
hidden or missing-artwork references stay empty and produce a visible warning;
they do not move the corresponding installed tile or change its placement.

The SD menu draws available original/custom animated icons at the original
anchors, retains source focus artwork and remembers all twenty pages. A
populated card uses the existing minimum loading interval. Selecting an SD
channel shows a local launch-unavailable notice. Data Management lists the
fixture's saves and loaded channels, supports detail dialogs and additional
pages, and restores each selected tab. Move, Copy and Erase confirm the local
operation with `changed: false`; they preserve all fixtures and installed data.

## Evidence and remaining limits

SD errors use original `mn_Nocard` artwork with messages 169 (absent), 171
(unsupported) or 195 (process failure). GameCube uses messages 230/231 (absent
A/B), 232/233 (unusable A/B) and 234/235 (unsupported A/B). Original layout entry,
selection and block animation resources are reused. Restoring an SD tab replaces
only SelectIn's six selection-child tracks with the source SelectWiiFlash
endpoint, preserving the parent entry animation instead of highlighting Wii.

The USA 4.3 ChannelEdit `update_nand_free` (`0x813A100C`) and `update_sd_free`
(`0x813A1234`) build these labels from decimal digit tables, discard leading
zeros while retaining the final zero, and concatenate messages 156 and 242.
The SD path hides `N_Capa_00` and `T_Capa_00` when the medium is not ready or
its count is unavailable. A ready SD fixture now exposes these same capacity
panes. Validation and scene tests cover zero, maximum counts, invalid values,
both tabs, status failures, localization, and forwarding through Menu Scenes.
No native free-space query or write operation is emulated.

Regressions cover sparse slots on pages 1, 2 and 20, completed-scroll persistence,
all media statuses, two pages of synthetic saves, original message selection,
remembered tab appearance, immutable operations and malformed-file/API recovery.
These fixtures do not emulate a real SD filesystem, Memory Card formatting,
launching, actual capacity or save transfer. Error-branch native timing, populated
masking/detail variants and complete native comparisons remain unverified.

The September 21 isolated browser check exercised SD page 2 and reload, the
16-record Slot B fixture across two pages, save details with Copy cancellation,
populated Wii/SD saves, installed Wii channels and the explicit SD channel list.
Reload restored the selected SD channel tab. The synthetic Message Board
retained all 23 records after paging. Absent and read-error SD fixtures displayed
their original messages with page navigation unavailable. The ignored audit
`artifacts/browser-qa/storage-memo-fixture-audit.json` records the loaded module
hashes and observed flow; it does not establish native timing equivalence.

Remote and storage preferences share `tools/validated-json-state.mjs` for
validation, serialization, lock ownership and atomic replacement. Each state
retains its own schema, size bound and missing-file default.
