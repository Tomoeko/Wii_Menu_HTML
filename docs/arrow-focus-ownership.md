# Arrow focus ownership audit

This ledger records the shared arrow controllers and host routing reviewed for
the reported repeated hover cues and bubbles disappearing after a click. It is
an implementation audit with source-resource regressions, not a claim that every
surface has been aligned against a native motion capture.

## Host routing

`arrow-interaction.js` lists the persistent control IDs below. DOM pointer
enter/leave and per-frame reconciliation both resolve against the current
source-rendered hit rectangles. An overlapping sibling's DOM event cannot
override an arrow that still contains the pointer. There is no extra hover
padding, debounce interval or synthetic pointer departure after activation.
Keyboard focus deliberately goes directly to the focused control instead.

Visible disabled controls still occlude text selection, but cannot activate or
start held repeat. Disabled arrows retain their source hit rectangle during an
owned transition. The controller decides whether focus is still accepted; an
unavailable arrow disappears from its control list. Pointer capture release
does not clear hover, while departure, cancellation and blur end held repeat.

`main.js` delegates hover before choosing a generic sound. Footer, SD,
BoardCreate, storage and posted/incoming readers own their sounds. Settings
keyboard handling returns before the generic sound path. A reader's
`readingMemo` state covers incoming Letter IDs as well as the Memo prefix.

| Surface | Host control IDs | Focus and sound owner | Relevant coverage |
| --- | --- | --- | --- |
| HOME Menu and drag paging | `prev`, `next` | Common footer; `buttonHover` once on entry. Drag uses the same source bounds. | `footer-controller.test.js`, `hover-routing.test.js`: both aspects, diagonal boundary trajectory, page action and genuine departure. |
| Channel preview | `prev`, `next` | Independent preview arrow state; host generic `buttonHover`. Hidden grid footer receives no focus. | `preview-transition.test.js`, `hover-routing.test.js`: banner swap, press flash and retained focus. |
| SD Menu | `sd-menu-prev`, `sd-menu-next` | SD controller; owns hover cue, separate focus/press clocks. | `sd-menu.test.js`: page motion, departure and bounds. |
| Board dates and crowded-date pages | `scene-prev`, `scene-next` | Board common-arrow state; host generic cue. | `menu-scenes.test.js`: date motion and limits; crowded-page controller follows the same independent focus/press path. |
| Data Management | `scene-storage-prev`, `scene-storage-next` | Storage AnmPane-style focus; owns `WIPL_SE_BT_TARGETTING`. | `channel-management.test.js`: Channels, Wii Save and GameCube page focus/departure; all three native storage tab families retain their existing tests. |
| Address Book | `scene-address-prev`, `scene-address-next` | BoardCreate common arrows; owns targeting cue and accepts departure during the page transition. | `board-create.test.js`: page lock, persistent bubble and rollout. |
| Address input field | `scene-key-text-up`, `scene-key-text-down` | BoardKeyboard field; Address and Create forward active input and release, and the child owns character-focus cues. | `board-address-input.test.js`: both aspects, caret after manual scroll, 60-update repeat, pointer release, blur and disposal. |
| Unposted Memo | `scene-memo-scroll-up`, `scene-memo-scroll-down` | Shared Memo helper; BoardCreate owns targeting cue when closed and `WIPL_SE_CHAR_FOCUS` while editing. | `board-create.test.js`, `keyboard-text-hit.test.js`: source hit overlap, closed text opener priority, held repeat and manual scrolling. |
| Posted Memo | `scene-memo-up`, `scene-memo-down` | Shared display-arrow helper; reader owns targeting cue. Reader presses request one movement rather than editor repeat. | `board-memos.test.js`: controls remain present during scrolling and focus retires on departure. |
| Letter composer | `scene-letter-scroll-up`, `scene-letter-scroll-down` | Shared Memo helper; composer owns targeting cue when closed and character-focus cue while editing. | `board-letter.test.js`: held click retains the bubble, one cue per entry, invalid/departure events are silent. |
| Incoming Letter reader | `scene-incoming-scroll-up`, `scene-incoming-scroll-down` | Reader owns targeting cue, native Loop and one movement per press. | `incoming-letter.test.js`, `incoming-letter-session.test.js`: reader transitions, child ownership and disposal. |
| Settings text field | `settings-keyboard-key-text-up`, `settings-keyboard-key-text-down` | BoardKeyboard text field; owns character-focus cue. | `board-keyboard.test.js`, `settings-keyboard.test.js`: delegated focus, availability, modifier and editor lifetime. |

The Memo/Letter editor repeat cadence remains the separately traced 60-update
initial delay and 20-update repeat. This audit does not add held repeat to a
posted reader or claim physical pointer timing from unit tests.

## Data Management page focus

The source is the supplied USA 4.3 System Menu. The input identities are:

- WAD SHA-256: `bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.
- DOL SHA-256: `47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.

Binary Ninja disassembly and decompilation establish separate ownership:

- `0x813A3864` binds base animation indices 9/10 to `ArwL1`/`AwrR1`,
  11/12 to `Select` on `G_ArwR_Ac`/`G_ArwL_Ac`, and 13–16 to the two
  `FocusOn`/`FocusOff` pairs. It registers each arrow's focus pair with its
  independent AnmPane.
- Pointer entry `0x813A18D0` and departure `0x813A1990` dispatch AnmPane
  commands 1 and 2 through `0x813A6F64`. They do not apply the parent action
  state check used by click handler `0x813A1A20`.
- Page handlers `0x813A15E8`/`0x813A1680` retire the grid boxes and call
  `0x813A4220`/`0x813A4288`. Those base helpers start indices 9/11 or 10/12;
  they do not restart or clear indices 13–16. Completion handlers
  `0x813A2268`/`0x813A2334` replace the page's 15 records separately.
- `0x813A6F64` queues the latest focus request until an active focus clip
  completes. The existing `createFocusAnimation` helper retains this behavior.

Previously the browser's generic phase start erased all focus state. A
stationary pointer consequently lost its bubble immediately, then played a new
targeting cue when paging ended. Channels now retains a separate arrow focus
controller through `page-out` and `boxes-in`. Real departure still runs the
authored rollout while activation remains locked. Arriving at a page boundary
retires the unavailable arrow. Tab changes, detail entry and other phases still
clear focus as before.

A separate trace verifies the same ownership in the other storage families:

- Wii Save constructor `0x813C6E84` binds page motion at 10/11, press at
  12/13 and focus at 14–17. Entry/departure `0x813C504C`/`0x813C510C`
  send shared AnmPane commands 1/2 without the click handler's parent-state
  gate. Page helpers `0x813C7780`/`0x813C77E8` start 10/12 or 11/13;
  their callers `0x813C4D64`/`0x813C4DFC` retire the grid independently.
- GameCube uses another button dispatcher. Its original table `0x81610368`
  binds motion at 12/13, press at 14/15 and focus at 16–19. Initialization
  `0x813C9F68` associates each arrow with its own focus pair. Entry/departure
  `0x813CBC20`/`0x813CBD20` send commands 1/2 to `0x813CCD9C` without a
  page-state gate. Click `0x813CBDE8` starts the press animation; page
  helpers `0x813CB9E0`/`0x813CBA90` start motion only when paging is allowed.
  Neither page helper clears the independent focus request.

All three browser storage families therefore retain arrow focus across the
same page phases. The regression uses 61 synthetic records, both directions
and both 4:3 and 16:9 projections in each family. It checks the rendered bubble
on every update of the current page transition, cue count, disabled activation,
departure during page-out and both moving and stationary arrivals at page
limits. This establishes the focus-lifetime correction. Exact grid-motion and
press-clip alignment still require their own native/browser comparison.

## Letter composer fixes

The composer forwards editing-arrow focus to the same input-form cue used by
Memo. Repeated hover or a held click does not replay `WIPL_SE_CHAR_FOCUS`;
departure and invalid targets are silent. The test uses original `my_LetterL`
resources and checks the expanded `P_txtScrll_UP` pose through scrolling.

Incoming Reply additionally owns an already entered common footer. Native
`0x81397CE0` starts Reply, uses `0x8139ABA4` to dispatch common departure 18
(3660–3673), changes labels and queues common entrance 15 (3313–3326) while
requesting child scene `0xB`. The browser reader completes those 26 updates
before creating its composer. Passing `footerAlreadyEntered: true` therefore
holds the footer at 3326 while the independent Letter `MailIn` body runs.
Ordinary Address entry keeps the default footer entrance. This scheduling
adaptation has a resource regression; concurrent native child/footer motion
still needs aligned capture verification.

## Inspecting repeated sound requests

The explicit `menu-inspect.html` page can record menu sound requests with
`createAudio({ onRequest: inspection.soundRequest })`. Normal application entry
omits the observer and creates no trace buffer or inspection listeners. This
diagnostic records requests to `play` and `startLoop`, including requests later
suppressed by mute, unavailable audio or the existing hover throttle. It does
not assert that every request produced audible output.

Use **Reset sound trace** immediately before approaching the arrow. The status
row shows the total request count and latest requested cue. It stays one line
so changing sound names cannot resize the viewport during the trajectory.
Press **F8** with the pointer still over the arrow to save the image and current
trace together. Ordinary frame saves and sequence captures include the same
`comparison.soundRequests` metadata; each sequence frame retains its own
snapshot. **F7** arms the next configured pointer action without visiting the
toolbar, preserving an already settled hover pose before a click sequence.
Inspect the requests' ordered `sequence`, `operation`, `symbol`,
resolved `sourceSymbol`, and `logicalTimeMs` to distinguish a generic host cue
from a native controller cue or repeated requests for one symbol.

The ring retains the latest 256 requests and reports `total` and `dropped`, so
overflow cannot be mistaken for a complete trace. Reset starts a new trace at
the current inspection time. Logical time follows the inspection clock and
stays fixed while paused; sequence numbers order events sharing that time.
Only cue identifiers and finite scalar gain/pan/pitch/speed or Boolean loop
options are retained. Audio bytes, URLs, paths, channel assets and text are not
recorded. BGM, channel playback and per-frame loop parameter changes are outside
this menu-cue diagnostic.

## Browser trajectory check

The September 21 isolated 16:9 inspector check used a 1065×706 viewport and
four real host pointer paths: upper and lower diagonal entries on each menu
arrow. Each captured trace contained exactly one `WIPL_SE_BT_TARGETTING`
request, including time left over the animated arrow. A subsequent left-arrow
click added only `WSD_SELECT`, with no duplicate focus request. The initial
path across channel tiles is recorded separately because it legitimately
requested channel hover and balloon cues before reaching the arrow.

The ignored `artifacts/browser-qa/arrow-trajectories/` contains images, ordered
request metadata, path labels and loaded-module hashes. This is evidence for
these pointer paths in the current browser, not complete native motion or
audible-output equivalence across every arrow surface and device.

Additional Wii Save and GameCube checks used 61 synthetic records per medium.
Both directions retained their bubbles through 61-frame page sequences. Each
diagonal entry requested one targeting cue; a second click with the pointer
left over the arrow added only the page cue. Arming the inspector moves the
pointer to its toolbar, so the captured sequence includes one legitimate
re-entry cue before the click. The saved request order distinguishes this
from a replay after the page lock ends. These fixtures establish interaction
ownership, not real save-image or media emulation.

Channels used a separate 31-entry paging fixture, reusing prepared artwork
under explicitly synthetic test identities. Its right bubble covered a populated
icon, and its left bubble covered an empty block on the last page. Both
directions produced one cue per diagonal entry and retained focus through
61-frame page sequences. Another right click added only the page cue; at the
last-page boundary the unavailable right arrow retired. The fixture was then
restored, and the browser reported no warnings or errors. This paging check is
separate from the six-channel same-NAND comparison in `storage-thumbnail.md`.

Channel-preview coverage uses the same viewport and installed Mii/Photo resources.
An upper-right diagonal approach and a lower-left approach each requested one
targeting cue. With the pointer left over the arrow, forward and reverse preview
changes each added only `WSD_SELECT`; their 91-frame recordings retained the
expanded bubble after the transition. The private `preview-arrow-ui` audit keeps
both complete sequences, approach stills and the loaded source hashes. No channel
was launched. These checks extend browser focus coverage, without establishing
native pointer trajectories or waveform timing.
