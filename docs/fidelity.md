# Fidelity target and acceptance plan

The goal is a browser representation whose graphics, animation, sound and
interaction match a specified original Wii System Menu baseline. **1:1 is a
target, not an achieved claim.** Original assets and correct-looking endpoint
screens are insufficient to establish matching complete transitions.

The [reference map](reference-map.md) identifies the supplied WAD and direct
resource/executable findings. The [implementation plan](implementation-plan.md)
tracks working behavior separately from acceptance. The
[retained evidence ledger](fidelity-evidence.md) indexes replacement captures
and the limited comparisons performed against them.

## Evidence matrix: version 0.1.0

This matrix accompanies package version `0.1.0` and the USA 4.3 WAD baseline
identified in the retained ledger. Categories describe the evidence available;
they are not a percentage of native equivalence.

| Category                        | Behavior                                                                                                                           | Evidence or explicit limit                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Measured approximation          | Address Book settled sheet edges and selected entry/cover-exit regions                                                             | Paired native/browser crops and sequence metrics in the [retained ledger](fidelity-evidence.md); residual pixel differences remain.                          |
| Implemented, comparison pending | Menu, channel preview, hover, dragging, Board, storage, keyboard, HOME and Settings presentation                                   | Controller/resource checks and selected browser flows; complete aligned image/audio sequences remain open. See the [coverage table](implementation-plan.md). |
| Approximate synthesis           | Sequenced sound effects                                                                                                            | Original samples, notes and timing; incomplete AX envelopes, modulation, pan and reverb. See [audio limits](audio-cues.md).                                  |
| Local dummy                     | Pairing, rumble, network, physical SD/disc state, channel launch and firmware operations                                           | Local fixtures and callbacks preserve implemented visible states; no hardware or discontinued service operation is implied.                                  |
| Unimplemented                   | Remaining Address/service branches, other attachment types and learned dictionary state | Sent local Letters now render as read-only Message Board outbox records. The composer can choose among verified local photo descriptors through its bounded picker, but it does not provide an arbitrary file picker or network delivery. Populated SD/storage, error fixtures and crowded-date paging are implemented locally. |
| Unverified baseline             | 4:3, other regions/versions and other browser rendering pipelines                                                                  | No comprehensive comparison set has passed for these baselines.                                                                                              |
| Accepted 1:1 scope              | None                                                                                                                               | No full scene/transition/audio scope currently satisfies the complete acceptance criteria below.                                                             |

Update the matrix with the package version, retained input hashes and measured
cases when publishing a new evidence revision. Keep partial crops and dummy
services distinct from complete native acceptance.

## Scope and service boundaries

| Area             | Target                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel screen   | Original background/masks, 4×3 grid, four pages, edge tiles, footer, arrows, clock/date, installed/empty slots.                                    |
| Input            | Pointer/hotspot, authored hit regions, held focus, delayed bubbles, press/release, transition locking and reversal.                                |
| Preview          | Open from the selected anchor, complete banner startup/loop, navigation, return to the original page/slot, Start callback.                         |
| Rearrangement    | Mouse grab mapping, valid/invalid drops, edge paging, Disc restrictions, floating-layer retirement and persistence.                                |
| Sound            | Correct cues, sequence voices, BGM/banner ownership, onset, overlap, envelope, loop and fade; explicit browser activation.                         |
| Other scenes     | Health, HOME, Options, Settings, storage, SD, Message Board, Calendar, Memo, Address Book, keyboard and dialog branches.                           |
| Local extensions | Authored custom channels, configuration, readable local records and import/export; these are functional extensions, not native graphic references. |

Actual title execution, physical media, NAND/IOS services, network access,
WiiConnect24, pairing, firmware operations and hardware settings use documented
local dummy state. Their visible interfaces remain within presentation coverage.
The absence of a hardware service does not justify omitting its animation.

## Rendering requirements

1. Preserve original pane hierarchy/order/origins, visibility, alpha inheritance,
   group bindings, materials, texture coordinates and keyed properties. Report
   unsupported resource data explicitly.
2. Separate logical projection (608×456 or 832×456), original NTSC framebuffer
   (640×456), output pixels and display ratio. Preserve location-adjustment
   flags and texture substitutions. Rendering straight into a wider framebuffer
   changes the Address Book's subpixel sheet-edge appearance; see the
   [executable and capture evidence](address-book-source-notes.md#sheet-edges-and-original-framebuffer).
3. Reproduce the required GX material combinations, wrapping, filtering, vertex
   colors, masks and blending. Record approximations instead of hiding them.
4. Evaluate original step/Hermite curves, reverse playback, loops and endpoints.
   Browser refresh rate must not alter elapsed animation time.
5. Use explicit scene state and input gates. Render and input completion must
   agree; rapid input must not create late tooltips or overlapping transitions.
6. Transform pointer coordinates through viewport and pane matrices, retaining
   hotspot/shadow placement and authored hit regions.
7. Use original font glyphs/metrics. Compare text rasterization separately from
   layout, including the original Settings page raster.
8. Decode sound sequences/banks/streams and compare actual playback. A correct
   event ID or isolated waveform is not proof of matching synthesis.

These are acceptance requirements, not a declaration that all are complete.

## Freeze a comparison baseline

Each reference/candidate pair needs:

- Menu region/version/title/content identifiers, WAD and executable hashes.
- Converter/renderer revision, exported manifest hash, original channel inputs
  and arrangement, language, service fixture state and configuration.
- Emulator executable hash and runtime version, or physical-console recording
  details; output mode, actual image dimensions, scaling/filtering/color path.
- Date/time, pointer position/orientation, deterministic input sequence and
  animation start/event alignment.
- Browser/version, viewport, device-pixel ratio, OS and audio sample rate.

A passing USA 4.3 widescreen case does not establish another region, 4:3 or a
different browser pipeline. Presented-image ordinals and audio samples have
separate clocks. Disabling duplicate-XFB skipping preserves repeated images;
it does not establish that each image corresponds to one simulation update.

## Compare full sequences

| Case                  | Required observations                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Boot                  | Warning entrance/prompt/exit, black loading interval, first visible menu update, audio activation.                             |
| Grid/hover            | Idle phases, every row/column, each footer icon, both arrows, delay boundaries, held bubbles and exit reversal.                |
| Paging                | Every legal direction, all intermediate frames, edge strips, clock continuity, boundary arrows and first idle update.          |
| Preview               | Corner/center slot opening and return, every zoom frame, composite mask/capture, full banner intro/loop and audio ownership.   |
| Drag                  | Pickup, stationary hold, movement, occupied/invalid/valid drops, cancellation, edge paging, no floating frame after placement. |
| HOME/Options/Settings | Entrance, hover, selection, child pages, dialogs, keyboard, return, scene faders and input locks.                              |
| Board/storage/SD      | Empty and populated fixtures, tabs, calendar/reader, pin/drag/erase, dialogs, page arrows and return composition.              |
| Robustness            | Repeated input during transitions, rapid hover changes, resize, reload/persistence, disabled/missing/full channel sets.        |

Retain native and browser images at matched states, side-by-side output, overlay
and difference images. Compare full frames and stated component regions.
Never silently shift, recolor or resize the candidate to conceal an error.
Document required normalization and retain raw data.

Report changed-pixel count, maximum channel error and mean absolute RGB error,
together with structural differences and input/animation boundary offsets.
A low average can conceal missing text, a wrong mask or a misplaced pointer.

Use two outcomes:

- **Exact for this frozen pipeline:** no unexplained pixel difference and
  matching event/animation boundaries for the named case.
- **Measured approximation:** disclose affected components, error magnitude,
  cause when known and any explicitly adopted tolerance.

Establish reference repeatability before assigning tolerances. Native RGB565
conversion, framebuffer sampling and browser output are distinct variables.

## Audio and state acceptance

Record input and audio together. Measure cue onset in samples/milliseconds,
overlapping voices, loop boundary, gain/fade shape, BGM restart/resume and
banner ownership. Exercise first-gesture activation separately from later
playback after the audio context is running.

State tests should verify bounds, selection preservation, one action per click,
transition locks, cancellation, navigation recovery and persistence. Controller
tests support those findings but do not replace native image/audio comparisons.

## Current evidence ledger

| Level                   | What it establishes                                                                                     | Current status                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource validation     | Decoded original assets, named panes/groups, checksum integrity and explicit executable findings.       | Implemented for the initial USA 4.3 inputs; see reference map and focused notes.                                                                                                                                                                                |
| Functional verification | Browser navigation, state, persistence, callbacks and testable animation boundaries.                    | Broad automated/browser coverage; specific unfinished branches remain in the implementation plan.                                                                                                                                                               |
| Native comparison       | Retained original and candidate images/audio, exact revisions/input alignment and measured differences. | Replacement captures include the clean 63,363-image Address Book, Settings, HOME and SD session. Address Book has bounded settled-pose and entry/cover-exit measurements; most other sequences have native observations only. See the retained evidence ledger. |
| Accepted fidelity       | All cases in a declared scope satisfy the stated criteria without undisclosed approximation.            | No comprehensive 1:1 acceptance has been established.                                                                                                                                                                                                           |

### Historical observations: unavailable artifacts

Earlier sessions covered health/Settings/SD/footer, Address Book, clean icon
loops and Disc/Shop transitions. A separate 39,000-image session covered native
QWERTY, Dictionary, prediction-off phone multi-tap, prediction-on composition,
Memo posting/reading and Trash confirmation/cancellation. Those PNGs, audio and
analysis reports are no longer available. Their old frame numbers and measured
errors must not be cited as current reproducible results.

Those observations prompted fixes including the Shop language title, retained
arrow hover, two-layer channel dimming, centered Board date, original SD Help
tables, and keyboard mode distinctions. Current tests preserve the implemented
rules. They do not recreate the deleted native evidence or close acceptance.

Replacement captures belong under artifacts/captures/ and must be indexed only
after recording, review and provenance checks. A running or completed recorder
does not by itself establish a comparison result.

### Replacement recordings: retained, limited comparison

`address-settings-16x9` completed with exit code zero, 63,363 images at 836×456
and original DSP/DTK audio. Its reviewed entry/exit intervals, stable HOME and
remote-control states, return choices, repeat SD loading, reconnection and
Console Nickname keyboard are indexed in [the current ledger](fidelity-evidence.md).
The Address Book reports quantify settled sheet-edge regions and selected
entry/cover-exit regions. Other listed observations remain distinct from matched
browser measurements.
No complete synchronized frame/audio sequence has been accepted as equivalent.

## Remaining limits

- Both aspect modes are implemented; full scene/transition acceptance at both
  ratios remains open.
- Original asynchronous loading may add a wait before channel zoom or menu
  reveal. Cached browser assets do not emulate those service timings.
- Channel layouts can depend on native scripts/modules and saved/network data.
  Supported branches are bounded in the [channel audit](../tools/assets/CHANNEL_SCRIPTS.md).
- Settings uses the original pages with a local bridge and raster adapter.
  Original-renderer text behavior, readiness gating, untested subpages, keyboard
  profiles and service result flows require further comparison.
- Optional local prediction executes the original USA 4.3 Zi8 code and data,
  starting from clean contexts. Learned state and remaining wrapper commands
  are incomplete; the separately selected authored fallback is approximate.
  Keyboard motion and modes still need retained native sequence comparisons.
- SD/storage and network-dependent screens use explicit fixtures; remaining
  Address/service branches and other attachment types are incomplete; populated
  and error storage fixtures plus read-only local Outbox rendering and the
  verified-photo picker are implemented locally.
- Native audio synthesis is not established by sequence decoding alone.
  Previously captured background PCM may remain in local assets, but a deleted
  source recording prevents re-export until it is recorded again.

Record new results with the case, original manifest, candidate revision,
artifact locations, metrics, outcome and remaining issues. Browser screenshots
alone remain functional checks.
