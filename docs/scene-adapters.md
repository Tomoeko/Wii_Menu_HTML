# Scene adapters and verification boundaries

The application combines original resources with explicit local controllers.
Resource/executable findings and automated tests support the implemented rules;
complete native image/audio acceptance remains open. Previous native recordings
were deleted. New evidence belongs under artifacts/captures/ and must retain
its provenance and input alignment.

## Channel opening and return

[channel-zoom.js](../web/src/channel-zoom.js) interpolates all four projection
corners between the full view and selected thumbnail over 28 updates, using
the zero-slope Hermite polynomial 3t²−2t³. The posed channel anchor supplies its
center. Thumbnail half extents are 64×48 in 4:3 and 85×48 in 16:9.

The preview is first composed at its default projection into one reusable
capture. Its opacity is the integer truncation of 255 times the Hermite value;
opacity applies once to the composite. Return reverses camera/opacity while
the outgoing banner continues. The grid's original ChMask is rendered after
clock/focus and before the preview capture; separate outside-black rectangles
complete the composition. Applying one fade to each preview layer, or omitting
ChMask, produces different overlap brightness.

Tests cover the actual posed mask, draw order, opacity quantization, wide
geometry, endpoints and reverse path. Previous native corner measurements that
identified the missing layer are historical; their capture files were deleted.
Full geometry, filtering/RGB565 conversion, banner phase, input/audio onset and
asynchronous loading waits need new paired sequences.

## Clock continuity and aspect transforms

The three original clock anchors are evaluated even when their panes are
invisible. Hit-test bounds cannot substitute for those matrices. A persistent
clock pose supplies the copies; paging does not restart its Wii Menu intro.

The browser's anchor traversal copies translation independently of visibility.
Its detached clock subtree retains the additional wide parent X contribution,
with local location adjustment preserving body width. This implemented
hierarchy rule still requires native widescreen paging comparison. Scene
projection and output ratio remain distinct.

## Options and storage

[menu-scenes.js](../web/src/menu-scenes.js) uses setupBg, setupBtn and setupSel.
Animations bind only their named groups. Entry runs the 16-update back bar
entrance and then the option entrances. Selection keeps a 40-update flash
alongside the sibling's 16-update exit. Back uses the original button selection
and returning heading intervals. Returning from Settings starts a fresh Options
entry after the global fade.

Storage exposes Save Data → Wii/GameCube and Channels using original
breadcrumbs, Wii/SD or Slot A/B tabs, 15 translucent blocks and Back. Entrance
runs DataIn (26), SelectIn (16), then boxes (26) for Wii and Channels.
GameCube starts SelectIn and boxes together after DataIn, waiting for the longer
26-update box clip. Each block owns focus state and sound. The dummy save title uses the original delayed balloon. TabFlash
binding follows the resource's opposite-named destination groups; empty Slot B
uses message 231.

The first Wii save fixture opens detail actions Move/Copy/Erase and original
Yes/No confirmation. Accepted actions report changed:false and retain the
fixture. [Versioned storage fixtures](storage-fixtures.md) now cover populated SD,
Wii/SD saves, both GameCube slots, additional pages and deterministic media
errors. SD page and each storage tab persist across reloads. These remain local
visual simulations requiring complete native comparison.

### GameCube entrance timing evidence

The read-only USA 4.3 executable audit resolves the base animation table at
`0x81610368`: entry 1 is `it_ObjCubeEdit_a_DataIn` / `G_DataAll`, and entry 5 is
`it_ObjCubeEdit_a_SelectIn` / `G_Select`. After entry 1 finishes,
`0x813CA980` starts entry 5 and, for a ready slot, calls `0x813CB188` in the
same update. That routine starts animation 0 on every save layout. Its table
at `0x81610480` resolves to `it_ObjCubeEdit_b_SaveDataIn` / `G_Data`.
`0x813CAA90` waits for both the tab and first save animation to stop before
unlocking the normal state. The browser previously serialized these motions,
delaying blocks by the entire 16-update tab appearance.

The corrected ready-slot entrance shares a clock for these two original clips.
Tests check simultaneous visibility, continued locking after the shorter tab
clip, and the unchanged Back-selection/exit sequence. The empty grid remains a
local fixture; absent-card/error branches and the exact native entry boundary
require aligned captures. This source finding does not establish 1:1 pixels.

## Settings presentation

Original HTML/CSS/scripts/pictures come from html/US2/iplsetting.ash. Converted
files preserve original payloads separately from a derived bridge-enabled
version. Original outline fonts retain glyph outlines and metrics.

The page engine runs offscreen and produces a 608×456 RGB565 raster. The menu
renderer presents this texture with original side panels, screen-change BRLAN
and the 20-update raster crossfade. Displaying the raw iframe directly is not
the final presentation path. [Settings rendering](settings-rendering.md) records
executable addresses, resource details, performance checks and remaining gaps.

The sandboxed bridge implements local values, original numeric sound dispatch,
navigation, exit/HOME and keyboard requests. The restricted Console Nickname
profile uses the shared original keyboard resources and returns edited text.
Other profiles and service/result flows need further coverage. Network,
firmware, pairing and format actions remain explicit local dummy events.

Browser rasterization can differ from the original engine even with its font.
Cached/fast focus rendering and readiness scheduling reduce browser latency;
they do not certify original pixel or input-boundary equivalence.

## Message Board, Memo and Calendar

The Board retains a fixed central date while arrows change the selected day.
Entry combines footer 1000–1040 with grid 70–90; return combines footer
6000–6040 with grid 100–120. Input remains locked through the transition, and
posted-card layers retire before the grid reappears.

Calendar uses original month/year/day/Today controls. Memo uses original editor,
keyboard and toolbar resources with local draft and posted records. Stored
records live in .local/message-board.json through the local API. They retain
their sampled position, subsequent drag placement and date. Original pin
arrival, bounded dragging, reader scrolling and Trash confirmation operate on
that local data. Calendar markers and footer counts derive from the same
records. [Message Board storage](message-board.md) documents the exact API and
remaining populated/crowded-date boundaries.

The footer keeps stopped signal groups after focus/scene groups for an empty
board, preventing an extra envelope. Populated state has independent count/
arrival playback. The SD icon disappears with its original fifteen-update
Out clip and reappears by reversing it. See [footer/SD notes](footer-and-sd.md).

## Keyboard and Address Book

The keyboard supports original QWERTY, phone, symbol and language popup
resources, prediction controls, physical input feedback and original cues.
Generic/Memo lifecycle and Settings profiles remain separate. Candidate paging,
Memo scrolling and generic field bounds use verified executable behavior and
original resources. The optional local worker runs the supplied USA 4.3 Zi8
instructions and dictionaries. The separate authored fallback is explicitly
identified and never silently used after a native-provider failure. Learned state,
remaining wrapper commands and complete native motion comparisons remain open;
see [keyboard notes](keyboard-source-notes.md).

Address Book repeats the original page panes with dynamic counts, aspect-aware
base movement, original draw order and cover/end wrapping. Page cues and
offline registration gate are implemented. Optional local registration forms
remain fixtures. [Address Book notes](address-book-source-notes.md) distinguish
executable findings, tests and the still-open native geometry/sequence check.

Letter composition, recipients, attachments, Mii selection, crowded-date
paging and remaining service/error branches need individual implementation and
comparison. The [implementation plan](implementation-plan.md) keeps those gaps
separate from local Memo and keyboard functionality.

## Verification

Run npm test for controller/local-state tests and npm run test:assets for asset
validation. Resource-dependent tests require prepared original inputs; absent
fixtures must be reported as skips. The [native recording guide](native-reference.md)
and [analysis tools](../tools/reference/README.md) use explicit input paths.

A complete acceptance matrix must enumerate original layouts, animation groups,
messages and Settings routes, identify each dummy boundary, provide a
deterministic fixture, record the original branch, and compare entrance,
idle, focus, selection and exit at both aspect ratios. Exporting a package or
passing its unit test does not complete that matrix.
