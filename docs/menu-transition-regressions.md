# Channel and footer transition corrections

The September 2026 pass repairs several independent controller ownership bugs:

- Grab appearance and phase time are separate. Entering the drag phase no longer
  resets the mask or shadow to appearance frame zero. Release retains its own
  uninterrupted clock through both drop phases.
- Drag page focus and page dwell use the same original expanding `B_ArwL` /
  `B_ArwR` target as ordinary pointer interaction. Pointer capture no longer
  suppresses arrow hover; held focus survives page scrolling and clears on leave.
- The footer, its SD icon and the date remain drawn throughout channel zoom.
  All use the zoom camera, underneath the captured preview and outside fade.
- Grid arrows use their original independent `G_ArwL_End` / `G_ArwR_End` bindings:
  appearance 10150–10160 and disappearance 10100–10110. Changing availability
  starts the corresponding clip rather than excluding the pane immediately.
- Returning from Message Board starts SD and grid-arrow appearance when the
  twenty-frame channel-grid entrance finishes. These clocks survive the final
  handoff from the forty-frame Board footer transition to the settled grid.

The supplied USA 4.3 binary's `Button::animation` at `0x8139CB58` selects the
independent left/right end controllers; its table at `0x8160F7B8` contains the
intervals above. `ChannelSelect::calcNormalRestart` at `0x813AC7D8` restores
available arrows after zoom completion. `calcCommon` at `0x813AAA38` restores
arrows and SD for Board return when its layout has stopped. The native draw
functions at `0x813AB0E8`, `0x8139C49C` and `0x8138F514` retain the shared ortho
transform across ChannelSelect, Button and Board drawing.

A fresh local capture in `artifacts/captures/roadmap-menu-regressions` preserves
6,673 presented images at 836 × 456. The Mii entry interval around 6130–6158
shows the footer moving with the grid camera, which corrected an earlier fixed
camera hypothesis. The WAD hash is
`bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`;
the runtime revision is `1363d7ce48a3b7cefaabc0e81faab527f87705d0`.
The process aborted with a C++ locale error after saving a paused state; its
metadata records exit code -6. Retained images remain observations of that
bounded entry, not a completed clean-session acceptance.

Focused tests cover appearance continuity, release continuity, complete arrow
intervals, page boundaries and the Board handoff boundary. Browser smoke checks
exercise channel entry/return and Board entry/return, including disabled footer
controls during zoom and a clean console. Complete aligned native/browser
sequences, resource-loading delays before zoom, both aspect ratios and physical
drag input remain acceptance work. Presented-image ordinals are not assumed to
be simulation-update counts.

## New complete interaction exports

The second capture, `artifacts/captures/roadmap-menu-return`, stopped cleanly at
25,155 images with valid DSP/DTK WAV headers. The retained browser exports use
`menu-inspect.html`, fixed 60 Hz updates and complete final-sidecar manifests.
Every comparison records original PNG hashes and explicitly normalizes native
836 × 456 presentation width to the 640 × 456 browser framebuffer using Lanczos.
This resampling is for pose comparison and does not establish raw-pixel equality.

- Mii entry: browser `1789968770116-02ba05e7.json`, native 6126–6162 in the first
  session. The broad footer/date camera motion matches. Small geometry, preview
  control and independently phased channel-icon differences remain. The preliminary
  report has no associated authored-source snapshot and cannot close acceptance.
- Disc entry: browser `1789969066699-18eafd65.json`, native 20830–20990 in the
  second session. The complete rotation follows the corrected twice-advanced
  source clip and reaches its endpoint. Over browser updates 28–98, the selected
  disc region has mean absolute RGB error about 0.94; header, pointer, preview
  arrows and footer are outside that metric. Original source hashes are retained
  with this export. Native ordinals still are not simulation timestamps.
- Board return, page one: browser `1789969254971-26e84b94.json`, native
  23394–23448. Page two: browser `1789969344819-3b0ba619.json`, native
  25014–25065. Both exports include SD appearance and arrow re-entry. Paired
  reports expose an independent readiness difference: native ChannelSelect
  construction admits its grid during the ongoing footer rotation, whereas
  browser resources are already loaded. The first native interval starts after
  the initial press highlight and cannot validate that onset. These reports
  remain diagnostics, not complete acceptance.

The original Board event handler at `0x813935D4` requests the ChannelSelect
child and calls `cmn_create_child` (`0x81392E94`); that queues the Button
animation. `Button::calc` (`0x8139C2B0`) consumes its own command queue and
advances its layout independently of child construction. ChannelSelect's
`calcCommon` (`0x813AAA38`) admits SD/arrows when its own layout finishes.
A fixed browser delay chosen from one captured load is not justified by these
independent clocks. The readiness boundary needs further paired cold/warm
measurements before its visible timing can be accepted.

The later hashed browser exports `1789981654729-86e4d6ce` (page one) and
`1789981739590-2227722d` (page two) each retain 81 poses and an associated
109-file loaded-source archive. Expanded native ranges 23380–23460 and
25000–25075 include the previously omitted press onset. Separate left-footer,
SD, date and narrow arrow-region measurements are retained under
`artifacts/menu-comparison/board-return-current-page-*-footer-sd`. Alignment
uses only the left footer and SD; unrelated channel artwork no longer chooses
the matching pose. Mean absolute RGB errors are 2.408/2.869 for left-footer
controls and 2.960/2.144 for the SD region on pages one/two. A footer-only
diagnostic is also retained: after rotation settles its unchanged pixels cannot
distinguish native poses before and after SD appears, so it cannot by itself
measure later SD agreement.

These exports demonstrate continuous browser SD appearance at updates 20–35,
available-arrow re-entry at 20–30, and preservation across the Board-to-grid
handoff at 40. They do not close the independent native child-readiness gap.
The empty browser Board selected September 22 and returns to the September 21
menu; native selected September 21 throughout, so date-region RGB differences
include different text. Narrow arrow regions still contain underlying tiles,
whose content and animation phase differ; their scores are not isolated arrow
errors. The retained native session used its recorded savestate and enabled
background input. Browser populated return `1789981589442-22542bfc` is useful
supplemental evidence but remains unpaired to a populated native Board. These
widescreen, best-fit pose comparisons do not establish elapsed-time equality,
physical-input onset, cold/warm readiness equivalence or 4:3 acceptance.

The later Mii entry `1789984370936-300301b1` and return
`1789984459760-fb4ee436` each retain 91 browser poses and the exact loaded source
archive. Entry uses native ordinals 6126–6162 from the aborted first session;
return uses 2825–2875 from the clean second session. The reports under
`artifacts/menu-comparison/channel-{entry,return}-current*` retain both broad
footer-region and narrow lower-edge diagnostics. Neither is an isolated footer
score: once the zoom carries the footer offscreen, independently animated
channel tiles occupy even the bottom edge. Those pixels must be excluded using
per-pose draw ownership before these metrics can support footer acceptance.
These exports repair the earlier missing browser source association, but they
do not establish full-frame or elapsed-time equivalence.

## Independent Board-return readiness audit

The retained page-one and page-two footer/SD comparisons were reproduced from
their original images. All pairs and input image hashes match the previous
reports, and all 109 files in the associated browser source archive verify.
The reproducible audit and reviewed crops are retained under
`artifacts/menu-comparison/transition-audit`.

A separate landmark check avoids matching the combined footer and SD region.
It finds the first image after which the left-footer rectangle
`[0,350,116,455]` remains byte-identical to its final pose, then measures the
final uninterrupted cyan appearance in the SD interior `[123,388,141,424]`.
The latter uses `B-R > 15` and `G-R > 10`, after the rotating Board button has
vacated that region. It marks visible SD interior color, not first nonzero alpha.
Native images use the already documented horizontal Lanczos normalization.

| Sequence | Unchanging footer begins | Persistent SD interior begins |
| --- | --- | --- |
| Native page one | Presented image 23414 | Presented image 23424 |
| Native page two | Presented image 25027 | Presented image 25029 |
| Browser, both pages | Update 28 | Update 27 |

This independently establishes different relative ordering. The two native
ordinal gaps are different and are not durations or simulation-update counts.
The combined low-error pose match therefore cannot establish a common readiness
boundary or justify adding a fixed browser delay.

Fresh inspection of the supplied mapped binary verifies the controlling gate.
At `0x813AAA4C–0x813AAA74`, ChannelSelect requires state `+0xC0 == 2` and its
layout at `+0x68`, controller zero, to have stopped playing. Only then do
`0x813AAB88`, `0x813AABB0` and `0x813AAC04` issue the available left/right
arrow commands and SD appearance command. The Board handler at
`0x813936C4–0x813936D8` requests the child and separately queues the footer
transition; `Button::calc` consumes its own queue. This is a child-layout
completion condition, not a delay measured from the footer animation.

The browser currently derives `gridFrame = 100 + min(20, phase.frame)` from
the forty-frame footer exit phase in `menu-scenes.js`; `menuFooterState` enables
SD/arrows when that same phase reaches twenty. With already-loaded browser
resources, the grid and footer start together and this represents completion
of the grid's existing twenty-frame clip. It does not represent independent
child construction or a deferred grid start. Exposing that clip's completion
would improve ownership clarity but would not by itself resolve the observed
native loading-phase difference.

The next discriminating capture keeps the selected date and menu date equal,
repeats page-one and page-two returns after cold startup and after warm returns,
and records actual emulated updates with separate input, grid-admission,
child-layout-completion and footer landmarks. Any future deferred browser
construction should advance the grid clip from its own readiness boundary.
These retained captures use archived browser source; the current footer and
scene modules have since changed. No M01–M05 acceptance gate is closed by this
bounded audit, and no UI timing was changed to fit it.

## Pointer boundary reconciliation

DOM pointer enter/leave and the per-frame arrow check now use the same rendered
hit regions. Previously a sibling's queued boundary event could clear an arrow
that still contained the pointer; the frame check then selected it again and
restarted its focus cue. The shared resolver gives the currently hit persistent
arrow the same priority in both paths, including Channels Data Management.
It does not enlarge hit panes, delay departure, debounce sound, or change the
original animation. Keyboard focus still follows the focused control.

The regression drives diagonal points along the expanding original left/right
hit panes in both aspects while delivering overlapping sibling enter/leave
notifications. It requires a single uninterrupted entrance, the complete bubble
pose, and normal disappearance on a real departure. A separate Memo regression
converts the clipped idle Down button center through a scaled browser rectangle
and checks every hover frame. The later isolated browser click failures were
caused by automation viewport drift and do not establish an additional app
input defect. Physical-pointer validation of the reported angle-sensitive
chatter remains required after this host event-routing correction.
