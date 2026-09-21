# Data Management channel thumbnails

Data Management uses a separate native thumbnail path from the HOME Menu.
`poseStorageThumbnail(channel, frame, { language })` implements that path in
`web/src/storage-thumbnail.js`. It returns a fresh pane/material pose without
modifying the imported channel. Language-selected bases are cached by source
layout and language; they are not shared with the HOME Menu's script state.

The supplied USA 4.3 executable, SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`, provides
the following verified behavior:

- `Thumbnail::create` (`0x813AA23C`) creates `icon.brlyt`, selects language panes,
  and binds `icon.brlan` if present, otherwise `icon_Whole.brlan`. It does not
  bind `icon_Start`, RSO animations, or channel startup scripts. The helper uses
  exact resource names and the shared frame-controller sampling rules.
- `ChannelObj::setLangPane` (`0x813B24C0`) hides every nonselected group except
  Rso0–Rso15. It then explicitly shows the selected group's members, restoring
  panes shared with other language groups. Ungrouped panes keep their authored
  visibility; HOME Menu-specific text, parent visibility and network-state
  overrides are not applied.
- The language table at `0x8164E300` maps CHT to ENG. When the selected group is
  absent, the USA fallback row at `0x8164E368` searches ENG, FRA, SPA in that
  order and enables the first available group. These are USA resource rules;
  other-region fallback tables are not represented by this helper.
- Language selection occurs before animation binding. A bound icon animation
  can therefore change visibility afterward. RSO group membership alone does
  not animate a pane.

The prepared Internet, Everybody Votes, Check Mii Out, Nintendo, Wii + Internet,
and Netflix icons contain startup/RSO animations but neither native thumbnail
animation name. Their Data Management poses consequently remain static across
time. The HOME Menu continues using its separate channel animation schedules.
Changing the thumbnail path does not change storage-grid geometry, clipping,
which titles are manageable, or menu-channel placement.

Focused tests cover binding priority and looping, static script-driven icons,
shared language panes, USA fallback, selection-before-animation ordering and
source immutability. Local resource checks exercise all six prepared downloadable
icons. The parent grid comparison uses the `data-management-followup` native
capture; this source audit alone does not establish pixel equivalence of the
integrated grid.

`ChannelEdit::draw` (`0x813A17F4`) draws the grid boxes at
`0x813A183C..0x813A1858`, then fifteen title balloons at
`0x813A1864..0x813A187C`. It explicitly redraws the original `N_ArwR` and
`N_ArwL` subtrees at `0x813A1880..0x813A189C`, before the detail layer at
`0x813A18A0`. The browser now repeats those same subtrees after the complete
grid and balloons, preserving their transforms, animation and hit bounds.
This keeps the minus/plus bubbles above both thumbnails and empty cells.
Both-aspect renderer regressions verify actual primitive order and that detail
and confirmation layers still cover the arrows.

The follow-up browser run used the same six imported banner hashes as the
retained Dolphin NAND, with authored example channels disabled only in the
isolated comparison fixture. The settled grid region's mean absolute RGB
difference was 1.234 on an 8-bit scale. A 61-update detail entry was aligned
against native presented images 23000–23065: the detail region averaged 1.132
and the footer region 1.527 after the separate translation and Back queue fixes.
The comparison explicitly resizes native 836×456 images horizontally to the
browser's 640×456 framebuffer using Lanczos and excludes the pointer region.
These are bounded pose comparisons, not raw pixel equality or elapsed-time
measurements. Reports and source hashes remain in ignored browser-QA artifacts.

Live UI checks also exercised detail entry/Back and both Channels tab selections.
The unselected SD tab returned to its exact initial pixels in the measured tab
region after pointer departure. Free-block text remains a declared local fixture
value; title allocation metadata is accounted separately from NAND free space.

Channels detail uses `mn_ChannelDetail_a`, already present in the prepared
`chanEdit` archive. `ChanAppEdit`'s constructor (`0x813A54DC`) binds that layout's
36-frame SeenIn, 11-frame SeenOut and operation-button animations. Save Data
continues to use its separate `081210_sys4_mn_DataDetail_a` resource. The Channels
dialog selects N_Mask4x3 or N_Mask16x9, fills the corresponding title pair and
both block-count panes, and leaves an absent second title empty. It does not
invent a local-channel subtitle.

`anmFadein` (`0x813A5EB8`) creates a new thumbnail and copies the selected
N_Atari pane's **local** translation into its root. The 12-update window movement
is independent. `draw` (`0x813A5C5C`) draws the dialog first, waits until SeenIn
is past frame 15, clips the thumbnail to half-extents 64/85 by 48 in 4:3/16:9,
then redraws the selected mask subtree over it. The browser follows that layer
order and resets the detail thumbnail's animation age on each selection. The
thumbnail is removed when detail fade-out begins, as in `anmFadeout`
(`0x813A6418`). That function then calls the animation starter (`0x813A7100`)
with immediate layout calculation enabled. `Object::calc` calls
`AnmPane::calc` (`0x81369BBC`), which advances the frame controller before
applying the pane pose. At speed one, the first drawable SeenOut sample is
frame 1, not its reset frame 0: the original Cover_4x3/Cover_16x9 alpha changes
from 0 to 255 between those samples. The browser likewise starts departure at
frame 1 while removing the independent thumbnail, keeping the original gray
cover and material instead of exposing a one-pose hole onto the grid.
Nonloop playback ends at resource frame count minus one (`0x81369ABC`,
`0x81362890`), so nine subsequent updates reach frame 10. The detail and parent
state checks (`0x813A5B74`, `0x813A2910`) return to the grid on that update.
Both-aspect resource regressions cover the first drawn cover, shrinking window,
thumbnail removal, all six surviving grid icons and source immutability.
The retained native Internet Channel detail at
`data-management-followup/Frames/framedump_23880.png` shows the header thumbnail,
one title line, block count and three operation buttons.

The underlying grid has a separate lifetime. `ChanAppBox::draw`
(`0x813A4D1C`) skips thumbnail drawing for parent page-scroll states 5/6
(`0x813A4DA8–0x813A4DB4`) and the box's own fade states 2/3
(`0x813A4DB8–0x813A4DC8`). Detail entry, operation dialogs and returning with Back
do not hide every grid thumbnail. The browser now tests the box transition
instead of suppressing icons during every active scene phase. Regressions
exercise all six underlying icons throughout detail entry, operation/dialog
transitions and return, while retaining native suppression during box entry,
exit and tab changes. Geometry and imported block-count metadata are verified
separately from these draw-lifetime rules.

Detail entry keeps the layout and interpolation clocks separate.
`ChanAppEdit::calc` (`0x813A5AD8`) calls the layout calculation before
`on_fadein` (`0x813A6BEC`) advances the linear controller and writes N_Window's
local translation. `Object::calc` (`0x8136A704`) has already calculated the pane
matrices, and `Object::draw` (`0x8136A79C`) draws those matrices. The original
constants at `0x81694928/2C` are twelve updates and speed one. Retained USA 4.3
widescreen entry frames 23006–23020 show the displayed translation two updates
behind the SeenIn scale: scale update 7 has movement update 5; scale update 11
has movement update 9. Both reach their final pose at update 14. The browser
preserves this delay and the invisible window on the trigger's initial update.
Tests compare the resulting window centers with measured native panel edges;
they do not substitute a different easing function.

Back has its own queue. `change_button_text` (`0x813A6B40`) reserves commands
2, 3 and 1: hide, set caption, show. `SettingButton::calcNormal`
(`0x814072F0`) waits for its alpha and press animations before consuming the
next command. Original 11-frame AlphOut and AlphIn resources produce a hidden
button at entry updates 11–12; the caption changes to message 252 while hidden,
and opacity returns fully at update 22. Detail exit queues the same transition
to message 315. The setting host creates Button child 22 before Settings child
19 (`0x81406DCC`, `0x81406DE4`); sibling append (`0x81362730`) and preorder
calculation (`0x8140A84C`, `0x8140A89C`) preserve that order. On return, Channels
observes the completed button press after Button has calculated for that update.
The next Button calculation consumes Hide in `calcNormal` before `calcCommon`
(`0x81407414`) advances the alpha animation, as ordered by `0x8140B254`.
The exit queue therefore has no extra idle update before the first alpha step.
Native frames 18048–18069 show one opaque departure pose, ten fade steps, a hidden
SetText pose and ten appearance steps. That queue can continue after the detail exit has
finished, so Back remains input-locked until its own animation finishes. Native
footer pixel measurements over frames 23006–23028 and both-aspect resource
tests cover this ordering. A fresh integrated comparison after the correction
is summarized below; the tests alone do not establish complete pixel equivalence.


## Retained follow-up comparison

The September 21 USA 4.3 widescreen comparison uses the same six downloadable
channels from the retained NAND input, excluding authored example channels in
an isolated browser fixture. Their source banner hashes match the native input.
The installed Internet Channel reports 28 blocks from validated content-directory
allocation metadata, including full padded content files where the TMD hash
verifies the unpadded prefix and the remainder is zero.

The settled grid comparison uses native frame 6710 and browser capture
`1789975137266-55ec3258`. Native 836×456 output is explicitly resampled to
640×456 with Lanczos. Mean absolute error is 1.234 byte values in the grid,
2.849 in the tabs and 1.468 in the footer. These measurements include rendering
and resampling differences; they do not imply exact equivalence.

The corrected 61-image entry sequence `1789976196542-4f80643f` is matched by
pose against native frames 23000–23065, with the pointer region excluded.
Mean per-pose absolute error is 1.132 in the detail region (maximum 2.761),
and 1.527 in the footer (maximum 6.641). The earlier sequence before the timing
fix measured 3.914 and 10.264 respectively. Matching by pose verifies visible
state progression, not wall-clock scheduling. The comparison reports, masks,
source hashes and full browser frames remain in ignored local artifacts.

A fresh isolated native recording, `channels-detail-back-fresh`, enters the same
six-channel grid, opens Internet Channel and returns with Back. It uses the same
WAD hash, the recorded Dolphin runtime, a copied reference NAND, no savestate,
and disabled background input; the native application exits cleanly. Native
frames 18031–18075 cover Back press, departure and restored footer. The existing
61-image browser Back sequence `1789976241818-1d75f97c` was aligned against native
frames 18020–18090 using the recorded horizontal Lanczos normalization and
pointer exclusion. Its detail/grid mean absolute error was 1.607 and footer
error 0.771, but browser update 19 exposed the transparent-cover boundary above
(detail/grid error 13.803). This pre-correction sequence has no associated
authored-source hash snapshot; it must not be attributed to the corrected source.
The final 61-pose browser sequence `1789982027491-c9ac9cab` includes both the
first-sample correction and the independent Back queue correction. Its exact
109-file loaded source archive and hashes are retained. With the same regions
and normalization, detail/grid error averages 1.403 (maximum 2.018); footer error
averages 0.768. Browser update 19 matches native 18048 with the original opaque
gray cover, and the next update matches the first footer fade. The initial
trigger pose still has a footer error of 11.541; over updates 1–60 the footer
mean is 0.589 and maximum 0.925. These bounded results resolve the transparent
cover hole and subsequent queue delay, while retaining the initial press-pose
limitation. A second 61-pose sequence, `1789982342735-9afbb492`, arms recording
with F7 while Back remains hovered; the pre-click F8 pose is retained as
`1789982312674-e1e5eb5f`. Its independently verified 109-file source archive and
comparison produce the same regional metrics, including the update-zero outlier.
Hover setup therefore does not explain that outlier. The inspector intentionally
draws update zero after the DOM action with zero simulation time, whereas native
animation calculation advances the controller before drawing its first sample.
This synthetic trigger boundary has no demonstrated native presented counterpart;
updates 1–60 are the relevant measured simulation progression. No runtime offset
was added to fit that extra diagnostic pose. Native presented-image ordinals and
pose matching do not establish
wall-clock timing equivalence, and this widescreen pair does not replace a
4:3 native recording.

Live browser captures also show
both unselected Channels tabs returning to idle after departure. GameCube
captures `1789977516210-682b8bdf` / `1789977527625-7415dea4` cover Slot B with
Slot A selected; `1789977650600-0588de3d` / `1789977738548-55f24219` cover the
reverse selection. Each shows the expanded hover pose followed by idle width,
with no browser console errors. The captured GameCube Slot B is a deterministic
missing-card fixture. Original-resource tests independently cover the Wii,
GameCube and Channels tab controllers in both aspect ratios.
