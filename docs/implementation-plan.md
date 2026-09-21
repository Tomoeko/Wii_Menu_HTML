# Complete menu presentation: implementation and verification plan

The goal is the complete visual and interactive presentation of a supplied Wii
System Menu WAD, using its graphics, animations, messages and sounds. Hardware
services use explicit local dummy state. **Full 1:1 fidelity remains unverified.**
Implemented behavior, resource checks, browser checks and accepted native
comparisons are separate milestones.

The initial prepared input is USA 4.3. Its nine decrypted contents passed TMD
integrity checks. The export contains 32 common packages with 116 layouts, seven
indexed message tables, original bitmap/outline fonts and 758 Settings files.
These counts describe one input, not universal menu-version support. Separate
channels require their own WADs or an explicit NAND import. See the [asset
inventory](../tools/assets/ASSET_INVENTORY.md) and [evidence map](reference-map.md).

## Implementation coverage

| Interface | Implemented behavior | Remaining native acceptance and scope |
| --- | --- | --- |
| Health warning | Original entrance, prompt and exit; final exit pose through handoff; integer 20-step grid reveal; optional skip and audio activation. | Compare complete exit/loading/input boundaries at both aspects. Loading can independently extend black. |
| Grid and paging | Original layouts, masks, textures, clock/date, pointer, held hover, delayed bubbles, four pages and original page intervals. Arrow hover survives paging; press has an independent clock. | Compare every page direction, edge strip, moving clock anchor, empty slot and stationary hover. |
| Channel opening/return | Clicked-anchor camera, quantized preview capture, original ChMask, outside dimming, banner intro and return to saved page/slot. | Synchronize all frames/audio from corner/center slots; account for asynchronous loading. Previous corner measurements are unavailable. |
| Preview and channels | Separate icon/module/banner clocks, language initialization including Shop title, ChangeIn/replacement/ChangeOut, original banner audio, soundtrack resume on return and a dummy Start button. | Verify complete loops for every installed channel. Unsupported module/data branches require explicit limits. |
| Channel management | Browser Channel Manager for creation, PNG/WAV upload, folder import, example install/repair, preview and Show/Hide; WAD/custom-package CLI; saved placement, fixed Disc, duplicate/invalid-data rejection and missing-layout/full-menu diagnostics. | Imported packages still need their own visual checks. Authored graphics are extensions, not native references. WAD import and intentional same-ID updates use the CLI. See [management](channel-management.md). |
| Channel dragging | Middle/right grab, original pointer/masks, edge paging, empty drops and persistence; floating layer ends at placement. | Compare pickup/release, invalid/occupied targets, cancellation, edge scrolling and drag audio. |
| HOME | Original resources, entrance/selection/retraction, remote-settings controls, local controller state/volume and grid return. | Compare transitions, hit regions and audio pause/resume. Pairing/rumble remain dummy services. |
| Wii Options | Original footer feedback/tooltips, black fade, bar/selector entrance, child navigation and fresh Options entry after Settings. | Compare headings, focus, branch timing and return at both aspects. |
| System Settings | Original page engine → 608×456 RGB565 raster, wide panels, page-scroll/raster transitions, local bridge and numeric sound dispatch. Connection hidden-icon freeze and same-document navigation lock fixed; restricted nickname keyboard supported. | Audit all pages/profiles, readiness/input gating, result dialogs and original rasterizer differences. See [Settings](settings-rendering.md). |
| Data Management | Breadcrumbs, Wii/SD and Slot A/B tabs, 15 independent translucent blocks, delayed dummy-save bubble, original tab selection and Slot B message. Populated channel/GameCube and read-error/unsupported fixtures are local and page-persistent. Dummy details expose Move/Copy/Erase and confirmation. | Compare complete populated/error sequences against native. Accepted dummy operations emit changed:false and preserve the fixture. |
| Message Board | Fixed date, day arrows, Calendar/Today, editable Memo, local draft/posted records, native position bounds, pin arrival, persistent drag, reader scroll, crowded-date paging, Trash deleting the local record, Calendar icons and footer count. | Compare all frames/audio, attachments and remaining Letter flows. See [Memo storage](message-board.md). |
| Address Book | Cover/page turns and sounds, repeated 20-page stacks, aspect-dependent base movement, cover/end wrap and offline registration gate. | Fresh native geometry/transition comparison and complete contacts/online-dependent flows. Optional registration forms remain local fixtures. See [Address Book](address-book-source-notes.md). |
| Keyboard | Original QWERTY/phone/symbol resources and cues; physical input; verified Settings profiles, candidate paging and long-text bounds; optional local execution of original USA 4.3 Zi8 code and dictionaries. | Native sequence comparisons, learned state, remaining wrapper commands, manual arrow repeat, other WAD profiles and Mii remain open. The authored fallback is separate and explicit. See [keyboard notes](keyboard-source-notes.md). |
| SD Card Menu | Configurable card icon, original disappearance/reverse return, dark 20-page grid/counter, black fades, tooltips, four-page welcome and three-page Help; populated-card selection, read-error/unsupported fixtures and page state persist locally. | Compare both aspects/audio and native loading/error timing. Card/storage services remain dummy. |
| Audio | Original menu/Board/keyboard/channel sounds, multi-track effect decoding, activation, menu/banner ownership, volume/mute and speed-modulated drag loops; optional captured background PCM. | Compare onset, overlap, mixing, fade, envelopes and loops. Decode/trigger success does not prove original synthesis. |
| Aspect/input | Separate 4:3/16:9 projections/output ratios, location-adjustment flags, wide donors and transformed hit testing; 16:9 default. | Complete every scene at both aspects and representative scaled viewports. |

Title launch, firmware changes, network services, physical SD/disc state,
WiiConnect24 and pairing are dummy boundaries. Their original visible screens
still require coverage. Exporting resources does not implement those flows.

## Evidence status

- Preparation and automated tests verify parsing, rejection, layout state,
  controller boundaries, persistence and local fixtures. Original-asset tests
  report skips when assets are absent; skips are not verification.
- Browser checks demonstrate functionality and expose visible defects. Native
  equality requires a retained original recording and a paired comparison.
- Earlier recordings of health, grid, SD, Settings, storage, icon loops, channel
  transitions, Address Book and the 39,000-image keyboard/Memo sequence were
  deleted. Observations informed implementation, but pixels/audio and reports
  are unavailable. These acceptance cases remain open.
- Replacement recording uses explicit emulator/profile/WAD inputs and stores
  artifacts under artifacts/captures/. Recording alone is not acceptance.

## Work order

1. Freeze input hashes, runtime, channel state, date/time, pointer, aspect,
   framebuffer conversion and input sequence. Preserve original images with
   duplicate skipping disabled, plus synchronized audio.
2. Compare the complete health → grid → preview → grid → Options/Board/HOME
   loop, stationary hover and repeated input. Fix structural/timing differences
   before accepting color tolerances.
3. Complete remaining visual branches using deterministic local fixtures:
   messages/letters/attachments, keyboard profiles
   and service-dependent Settings dialogs.
4. Compare every installed icon/banner over full startup/idle phases, and sound
   onset/overlap/loops. Retain all sampled images, not only contact sheets.
5. Record each accepted case using [fidelity criteria](fidelity.md). Resource
   presence and passing controller tests do not close visual acceptance.

## Portable structure

This project owns web/, tools/, docs/, config.json and package commands.
Explicit inputs supply original software. Private caches, saved arrangements
and readable Memo records stay under .local/; extracted original assets and
captures remain local. Public cryptographic constants and generated custom
example assets do not substitute for the supplied WAD.
