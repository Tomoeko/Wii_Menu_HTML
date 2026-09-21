# Footer and SD Card Menu evidence

The controllers use original layouts, BRLAN curves, message tables and fonts.
Intervals below describe animation updates, independent of browser repaint
rate. Real SD services are replaced by an explicit empty-card fixture.

## Footer and card icon

| Behavior | Original resource or implemented interval | Browser owner |
| --- | --- | --- |
| Wii Options focus | my_IplTop_e G_Set: 6900–6906 in, 6930–6938 out | footer-controller.js |
| Message Board focus | G_Bbs: 900–906 in, 930–938 out | footer-controller.js |
| Arrow focus and press | G_ArwL/R_Focus: 10600–10615 in, 10800–10815 out; press 10700–10730 | footer-controller.js |
| Empty-board signal | Stopped G_BbsSignal groups at frame 0 applied after hover/scene groups | footer-controller.js |
| Populated signal | Original count/new-arrival groups, with independent notification clock | footer-controller.js |
| Common bubble | Original TextBalloon layout; appearance on update 17, six-interval entrance, reversal from current pose | Footer balloon controller |
| Hover/bubble audio | WIPL_SE_BT_TARGETTING and WIPL_SE_BALLOON | Original effect entries |
| SD disappearance/return | mn_Sdcard_Btn BtnL_Out: 0–15, then 15–0 on return | sd-button.js |
| SD selection | BtnL_On: 0–20 concurrent with global fade | sd-button.js |

The arrow focus endpoint must remain held while the pointer stays in its
retained region, including during page movement. Press has a separate timeline.
The application previously cleared footer focus during every locked paging
update; it now preserves the owner and resynchronizes it before suppressing a
redundant pointer event. Browser checks and controller regressions cover the
persistent bubble. Complete native image acceptance remains open.

Home, SD, Address Book, Message Board days and Calendar months use
`arrow-interaction.js` for independent, persistent focus and press state. SD
previously cleared focus both on activation and on hover updates
during scrolling. Its controller now accepts arrow hover during the original
20-update page motion, retains the focus endpoint, and retires it only on actual
pointer departure or when that arrow disappears at a page boundary. The shared
helper uses the common footer's intervals above and the SD resource's own
rollover/rollout/press intervals (0–8, 0–12 and 0–27). It does not substitute the
Home timing into SD. Regression checks render through the parent hierarchy to
check effective visibility, expanded hit-area size and press independence.
Board and Calendar also previously cleared focus when paging started; Calendar
cleared it again at completion. Both now retain the pointer's actual state,
accept departure while moving and retire focus when an arrow reaches its date
limit. Address uses the same helper without changing its 28-update entrance or
48-update return queue. `isPersistentArrowControl()` centralizes the exact
application control IDs whose expanded hit regions survive locked page motion.

Bubble placement uses the posed hit-pane position plus Y=50, original
location adjustment and minimum width 160 times aspect scale. Common margins
are 120 wide/30 narrow; SD margins are 200/110. Empty mail signals must remain
stopped after focus composition; otherwise the focus group exposes an extra
envelope. Board arrival/count presentation is driven by local message records.

## SD executable findings

These addresses belong to the checksum-validated USA 4.3 executable identified
in the [reference map](reference-map.md).

| Finding | Executable/resource evidence | Implementation |
| --- | --- | --- |
| Return starts a global fade | Event 0x813E2B54 selects state 4; fade initialization 0x813DE24C | sd-menu.js → shared scene fader |
| Twenty pages | Constructor 0x813DAB08 | Bounded page state |
| Page scroll | 0x813E03B0; mn_SdcardMenu_a intervals 0–20 / 40–60 | Original grid playback |
| Shared empty tile | Creation 0x813E11C4; repeated draw 0x813DEF68 | One animation phase for every empty slot |
| Background | mn_SdcardMenu_b/background and my_BackPic_a.tpl | Own dark background, not the main date strip |
| Widescreen donors | 0x813DE9FC: ChangeTex16x9 into five panels; Picture_16 into five edges | Original texture mappings |
| Page counter anchors | Draw 0x813DE33C copies three anchor positions into page layout | Sliding /20 indicators, no menu clock/date |
| Native page save | Destruction 0x813DE6C8 saves page state | Browser currently retains page only within the run |

The application keeps menu music continuous through SD entry, navigation and
return. The inspected SD create/destroy paths did not introduce a new BGM
owner. A replacement synchronized native audio recording is still required
to accept the complete audio behavior.

## Loading from the SD Card

`sd-loading.js` plays message 170 in the original `mn_Nocard` layout. Its
construction at 0x813DEBB4–0x813DEC3C binds `IN_02` and `OUT_02` to `Group_01`,
and `Wait` to `G_Wait`. The latter group contains only the spinner: applying
the entire Wait animation would incorrectly hide the message panel.

Request type 8/message 170 is queued at 0x813DB824–0x813DB830. The message
controller at 0x813DCAC4 plays the 33-update entrance. Once the worker is idle,
the empty-card branch at 0x813DBEB8–0x813DBEF0 checks that the title count is
zero and the queued message request has cleared, then immediately queues close
request 1. It has no additional minimum hold. The ready empty fixture therefore
plays 33 entry updates followed by the 16-update exit.

The populated-list reconciliation path at 0x813DBFE0 is different. It requires
elapsed OS ticks to reach the timebase frequency, read as the bus clock at
0x800000F8 divided by four (0x813DC01C–0x813DC058). Its one-second minimum starts
at the entry-completion timestamp written at 0x813DCB50–0x813DCB60. That gate is
available through the loader's explicit `hasChannels` option; it does not apply
to the empty-card fixture. An optional `isCardReady()` callback keeps the
40-update spinner loop active if reading takes longer. The loop binds only
`G_Wait`, leaving the visible message panel intact.

The loader runs concurrently with the incoming global fade. It blocks page
and footer actions until exit completes. On the first visit, welcome precedes
loading: 0x813DDCD8–0x813DDD48 starts the card worker after that dialog closes.
The welcome scheduling remains behind the fade pending a matching first-visit
capture. Tests cover the empty and populated branches, a late worker, batched
updates, first-visit ordering and loading progress under the global reveal.

Fresh repeat-entry evidence is retained in the ignored
`artifacts/captures/address-settings-16x9` sequence. Global fade-out first changes
frame 49548; frames 49567–49576 are black. SD first appears at 49577, with its
loading entrance already advancing during the fade. Entry reaches its endpoint
at 49609 (33 presented samples inclusive), exit begins at 49610 and the panel
is absent by 49625 (16 samples inclusive). This matches the original empty-card
branch. The measurements and contact sheet are
`analysis/sd-entry-measurements.json` and `analysis/sd-entry-fine.png`. Presented
image ordinals establish this sequence; they are not wall-clock timestamps or
a full pixel-equivalence claim.

## Original information dialogs

Welcome and manual Help use different executable tables, both with
my_DialogWindow_a2, serif Utrillo body text and Rodin button text.

| Dialog | Table and call | Message IDs | Custom graphic |
| --- | --- | --- | --- |
| First visit | 0x8165439C, count 4; call 0x813DDC80 | 157, 158, 159, 202 | Page 3: wait_icon at Y=74; page 4: help_Btn at Y=108 |
| Manual Help | 0x8165440C, count 3; call 0x813DDD64 | 201, 158, 159 | Page 3: wait_icon at Y=74 |

First welcome hides Back. Next/Close/Back use messages 163/164/165. Entry is
0–24, selection 0–20, exit 0–20, with the parent observing completion on the
following update. Page content fades out/in by 26 alpha units per update,
including custom graphics and changed button labels. Focus restarts after
selection while old text can still be fading. No generic browser alert replaces
this dialog.

Welcome completion uses localStorage key wii-menu.sd-help-seen after all four
pages close, corresponding to the native flag handling at 0x813DDCD8. Removing
that key restores welcome. A memory fallback retains it for the current run
if browser storage is unavailable. WIPL_SE_INFO_WINDOW starts with the dialog.

## Verification boundary

Tests cover held/reversed hover, arrow press independence, cancelled bubbles,
stopped/populated signal composition, SD icon forward/reverse motion, page
bounds, shared empty-tile phase, background order, return locks, both dialog
tables, welcome persistence, loading readiness and focus recovery during text
fading.

Prior native SD welcome/grid and footer screenshots were deleted. Earlier
visual checks informed this implementation, but their pixels and measured
bounds are unavailable and cannot support current comparison claims. A fresh
inserted-card entry now exists in the ignored
`artifacts/captures/address-settings-16x9` sequence: frame 48057 is the main
grid and frame 50144 is the settled SD grid. The narrower loading interval is documented above; those broad endpoints alone
do not establish timing equivalence. Matching
hover, page, Help, exit and 4:3 sequences with synchronized audio remain
required. Populated-card interactions and page persistence across application
reloads remain additional implementation work.
