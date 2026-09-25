# Software keyboard evidence and boundaries

The browser keyboard uses the supplied USA 4.3 WAD's BRLYT, BRLAN, TPL,
BRFNT and BRSAR resources. The executable and original resources establish the
findings below. Names describe the recovered behavior; addresses identify the
actual executable code rather than another project's implementation.

Input WAD SHA-256:
`bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.
The default projection is 832×456 for 16:9. The current native Nickname capture
is frame 62270 in `address-settings-16x9`, indexed in
[the retained evidence ledger](fidelity-evidence.md). Older deleted images are
not comparison evidence. Matched keyboard animation and audio comparisons
remain required.

## Keyboard profiles and controls

Memo exposes original QWERTY and telephone keytops, symbol pages, the language
popup, prediction toggle and toolbar controls. Physical characters, Return,
Backspace, Delete, Caps Lock and held Shift animate corresponding original
keytops. Unicode editing, caret movement and the persisted local draft share the
same text state as pointer input.

Physical Caps Lock uses `capsLock` from `KeyboardEvent.getModifierState` on
both keydown and keyup. This handles a host that reports opposite lock changes
on different event edges without requiring multiple presses. Duplicate events
with the same reported state do not toggle it again. Later events reconcile a
hardware state change after focus loss; unchanged hardware state preserves an
onscreen Caps selection. Hosts without modifier-state reporting use one toggle
per nonrepeated keydown and never wait for a matching keyup. A blur event clears
held physical Shift. These are host-input adaptations, not Wii controller behavior.

Console Nickname uses `profile: 'console-nickname'`. The Settings initializer
at `0x813F4210` supplies IPL request type 6, maximum length 10 and one line.
The dispatch table at `0x81638DB8` and manager vtable at `0x816680A8` resolve
that request to `0x8143D3B0`: the big text field, both QWERTY and telephone
layouts, and no dictionary, language picker, symbols or line feed. The IPL
request enum and internal manager configuration enum are different; treating
both as the same enum previously selected the wrong profile.

Verified Settings requests use these original profiles:

| IPL type | Original configuration                                | Text field        |
| -------- | ----------------------------------------------------- | ----------------- |
| 3        | Numeric telephone keys, no layout switch              | `fs_VK_textBox_b` |
| 5        | QWERTY/telephone, symbols, no line feed or dictionary | `fs_VK_textBox_a` |
| 6        | QWERTY/telephone, no symbols, line feed or dictionary | `fs_VK_textBox_b` |
| 7        | QWERTY only, no symbols, line feed or dictionary      | `fs_VK_textBox_a` |
| 10       | Numeric telephone keys with dot, no layout switch     | `fs_VK_textBox_b` |

Numeric pane hiding is implemented by `0x8141A5D4`; `0x8141A878` restores
key 11 with a dot. `0x8143CB80` and `0x8143CBDC` choose the two text resources.
The secret-text path at `0x814353F0` uses character `0x2A` (`*`); masking changes
the displayed string while the original value remains available to the Settings
form. Cancel restores the original value; the original form's Confirm owns saving.

Language selection uses the original US popup containing English, Français and
Español. Prediction enable/disable retains the outgoing button and book-icon pose
through the original 12-frame clips. Language and symbol overlays use their
original appearance, disappearance, focus and pushed BRLAN resources.

### Reachable request coverage and telephone completion

A further audit of the supplied USA 4.3 dispatch at `0x81356050`, table
`0x81638DB8`, and manager vtable `0x816680A8` separates identified menu callers
from library configurations whose additional USA callers have not been established:

| Identified menu path | IPL request types | Browser coverage |
| --- | --- | --- |
| Memo / Letter | 1 / 2 | Separate original text sheets and shared keyboard controls |
| Settings nickname, numeric, network and answer fields | 3, 5, 6, 7, 10 | Original numeric, large-text, restricted QWERTY and symbol profiles |
| Address nickname, Wii Number and e-mail | 11, 12, 7 | Field limits, original text resources, numeric separators and layout restrictions |
| Special-language Settings / Address branch | 13 | Restricted predictive profile; the branch is not evidence for another USA Latin field |

The same table also resolves requests 0, 4, 8 and 9 to `0x8143CCBC`,
`0x8143D298`, `0x8143D6A4` and `0x8143D838`. Their presence does not establish
a missing user-facing USA path. In particular, request 9's numeric setup is
also called by the implemented dotted request 10. This audit adds no UI route
or unsupported regional mode merely to expose those configurations.

The reachable telephone layout did have a missing multi-tap completion boundary.
Its callback (`0x8141B55C`) forwards pointer departure as event 1 and also sends
event 1 when the continuing-hover counter equals 90 (`0x8141B98C`). The shared
button increments this counter once per continuing hover (`0x81445F64`), resets
it on entry/departure (`0x81445F88`, `0x81445F9C`), and resets it on a press
(`0x814465A4`). The phone handler (`0x81417274`, event-1 branch) commits the
pending key's current character through Base command 5, then clears its cycle
index and pending key record.

The browser now ends its replacement cycle after 90 hovered updates or pointer
departure. Every repeated press restarts that interval. The displayed character
is already present in browser text, so completion only ends its eligibility for
replacement. Host focus loss also ends that pending cycle. Telephone dictionary
composition has separate ownership and remains active across these events.
Original-resource tests cover the 89/90 boundary, pre-hover, repeated-press reset,
batched updates, departure/reentry, blur and preserved dictionary composition.
These tests establish controller behavior; aligned native/browser pointer timing
and telephone preview rendering remain acceptance work.

### Native telephone B trigger and the host mapping boundary

The phone callback `0x8141B55C` gives A (`0x800`) priority over B (`0x400`).
Its B branch accepts only the twelve names `B_CPkey_00` through `B_CPkey_11`
from the table at `0x8165C050`; it does not activate Delete, line feed, mode
tabs or toolbar controls. It starts the ordinary key press animation, sends
input event 4 with the reverse byte set, and resets that key's hover counter.

In the multi-tap branch of `0x81417274`, this byte decrements an existing cycle
index. With no pending key it selects the last nonzero character of the original
16-unit record; underflow also wraps there. For example, the original `abc2`
record starts at `2` on B and then moves to `c`, `b`, `a`, `2`. Numeric records
contain one character, so B inserts that character just as A does. The ordinary
Latin predictive branch does not read the reverse byte: it sends its existing
ambiguous telephone code through Base command 5. It does not reverse candidate
order, accept a candidate, erase the composition or cancel the keyboard.

Cancellation has different ownership. The toolbar callback `0x8142F0DC`
requires A for `P_BT_cancel`, Confirm and layout choices. The traced phone B
branch contains no call to that cancellation operation. This distinguishes
the source action from the browser's explicit Escape-to-cancel adaptation;
it is not a reason to reinterpret Escape as B while a phone key is focused.

The host mapping uses right-button pointerdown only over a visible, enabled
phone keytop in an active keyboard. Primary clicks retain their existing action;
physical printable keys insert text, and Escape still cancels. The host
suppresses `contextmenu` and `auxclick`. Middle/right buttons retain their
separately scoped channel and Memo-card grab configuration. No Gamepad API input
route is implemented. The controller supports
`activate(id, { secondary: true })` for B.
Existing calls remain primary; explicitly supplying both `primary: true` and
`secondary: true` preserves A priority. Secondary-only requests can reach only
visible phone keytops, before any other action changes text, sound or animation.
Original-resource regressions cover fresh and wrapped reverse cycles, the
90-update counter reset, A priority, numeric profiles 3/10/12, identical English,
French and Spanish prediction requests, and rejected secondary toolbar or
hidden-key actions. Settings, Memo/Create, Address, local Letter and incoming
Reply owners forward the fresh trigger only into their active keyboard. Other
owner actions reject secondary-only input before changing state. Integration
regressions exercise those complete routes and rejection in closed/opening
editors, readers, service dialogs, Calendar and Data Management. Live host input
and native visual acceptance remain separate from these controller tests.

## Verified transition and sound behavior

- `0x8143E428`, `0x8143E9A4`, `0x8143FFEC` and `0x814405F0` initialize, animate and
  reverse keyboard appearance. Root Y travels −200 ↔ 0 and alpha 0 ↔ 255 over
  30 updates, using a Hermite curve with zero endpoint slopes. The constants
  are at `0x816974C8` through `0x816974DC`.
- Nonletter input, including Console Nickname, moves the text field with the
  keytops. Memo instead moves its sheet from Y 0 to 145 and retains its opacity.
  The standalone background remains at the origin and fades with the keyboard.
- Toolbar vtable `0x8165E308` points from slot `0xB4` to `0x8142ED50` (`N_UP`) and
  from slot `0xB8` to `0x8142ED70` (`N_DOWN`). The lower toolbar uses root-Y/3;
  the upper mask uses −root-Y/3. During appearance the upper mask keeps alpha
  zero until the editing state starts. Disappearance updates both alphas.
- The Memo trigger at `0x813563B0` and standalone start at `0x81355C14` each
  request `WIPL_SE_SK_OPEN` once. Multiple audible parts belong to that cue's
  sequence; emitting a duplicate scene cue would not reproduce the original.
- The original `SK_OPEN` RSEQ opens track 1 at byte offset `0x15`. The second
  track rests 18 ticks before its first note. Each track has two notes with
  different velocities and its own pan. The exporter now follows both tracks.
- The sequence-track constructor at `0x81502AFC` sets byte `0xC1` to one.
  The parser reads that flag at `0x81501D88` and stores note duration as the
  wait counter at `0x81501D98`. Note-wait therefore defaults to enabled even
  when a sequence contains no explicit `0xC7` command.
- Shift/Caps dispatches are at `0x814132CC`, `0x814134D0` and `0x81413614`.
  Keyboard controllers emit original WIPL identifiers; the shared audio runtime
  owns decoding and playback. The browser mix is not claimed to be AX output.

Original pane and material animation targets are rebound together to isolate each
key's focus/pushed state. Text uses original font metrics for wrapping and caret
placement. The renderer's text-color animation mapping treats the top pair of
vertices as color 0 and the bottom pair as color 1; tests cover prediction text
that previously retained a zero-alpha template color.

### Selected controls and rejected input

The Shift/Caps binding records at `0x816595A0` refer to the animation table at
`0x816145E0`. `ShiftCapsAnmPane::onAnmEvent`, `0x81415F58`, keeps selected state
separate from focus: selected pointer exit uses state 9 (`toggleON_Focus-OUT`),
then state 10 (`normal_toggle-ON`). Selected pointer entry instead uses state 8
(`toggleON_Focus-IN`), then state 5 (`toggle-ON`). The selected-normal pose has
scale 1 and retains the yellow material. Reusing `toggle-ON` as its idle pose
incorrectly leaves the key enlarged. Ordinary hover uses the unselected clips
and does not change Caps state; only the activation path flips it.

If Caps is clicked while the pointer remains inside it, state 4 (`Pushed`)
completes into state 5 (`toggle-ON`) at `0x81416394`: the native key retains
its selected hover size until pointer exit. It does not force selected-normal
size immediately after the click. The regression asserts both the retained
focus case and the scale-1 selected pose after departure.

The original keyboard `AnmPane::calc` at `0x814371BC` advances until the resource
frame count, then transitions without presenting that out-of-range update.
One-frame poses remain at frame zero. This matters because unused later keys
inside `normal_toggle-ON` would otherwise turn the selected color white and
enlarge the key. The adapter now clamps this controller's presented motions to
`frameCount - 1`, while retaining the original state completion intervals.

Toolbar bindings at `0x8165E0B0` select the seven-state animation table at
`0x816156F8`. `ToggleButtonAnmPane::onAnmEvent`, `0x8142EF20`, ignores pointer
focus and repeated press while the layout choice is selected (state 5).
Unselected QWERTY/phone choices retain the original focus and pushed animation.
The browser follows that distinction without removing the selected hit region.

The ordinary character path at `0x8141CD5C` requests sound 10 before the length
check. `LayoutByNW4R::onCommand`, `0x81426C80`, rejects overflowing character or
row input and requests sound 8. The original IPL callback at `0x81354D54` maps
those to `WIPL_SE_CHAR_INPUT` and `WIPL_SE_CHAR_DELETE_ERROR`. This dispatch
order alone does **not** establish the audible mix. The earlier inference that
both cues should be heard on rejected input was incorrect. In particular,
`0x8136B46C` and the handle lookup at `0x8136C034` do not establish cross-cue
suppression; native NW4R player/voice arbitration has not been measured here.

Per the user's observed behavior, the browser now emits exactly one insertion
result cue: `CHAR_INPUT` only when accepted, or `CHAR_DELETE_ERROR` only when
length/row limits reject it. Rejection leaves the text and caret unchanged.
The same rule applies to physical characters, pointer keytops and telephone
prediction composition. Regression tests assert the exact emitted cue arrays;
sample-level native mixing equivalence remains open.

Fresh native Nickname frame 62270 shows **Quit**, rather than Back, on the left
toolbar button. Settings supplies the original localized Quit message 37 to
the shared keyboard. Memo retains its own Back label. Regression tests cover
selected colors/scales, repeated focus/press, rejected input feedback and Quit
cancellation; no new native Caps-hover sequence is claimed from those tests.

## Candidate strip and Memo scrolling

The candidate controller at `0x8142C424` and `0x8142C62C` overlaps the partial
edge word when advancing or returning a page. `0x8142C830` and `0x8142CB14`
start a zero-slope Hermite movement through frame 15. The width formula adds `0.01`
to the original font measurement, adjusts by `608 / projectionWidth`, and uses
10 units of spacing above projection width 700, otherwise 20. The browser now
keeps partially visible text and clamps its hit area. The original `0x8142C114`
draw path clips normal candidates horizontally; a focused candidate may expand
leftward while retaining the strip's right clip boundary.

Candidate redraws retain text ownership. `UITextArea::Create` (`0x8142B764`)
binds the clipping pane `N_prdcTextArea` at object offset `0xD8`, the text
container `N_prdc_Texts` at `0xDC`, and the individual candidate panes from
`0x38`. `Draw` calls the text container under the regular clip, then draws
selected candidate panes individually at `0x8142C3B4..0x8142C3E4` under the
expanded clip. These calls do not redraw the enclosing `W_predictWindow`.
The browser's pruned text layers previously retained that drawable ancestor:
hovering a word added another opaque window pass over all earlier suggestions.
Text-only layers now retain ancestor transforms and opacity without drawing
their materials. The original window is drawn once. A resource-based renderer
regression checks several simultaneous candidates, each candidate's separate
material and hover pose, departure, clipping, and page motion in both aspects.
This establishes the draw-order correction; browser/native visual acceptance
remains separate.

Visible candidate controls also retain pointer ownership while the original
page movement disables their input. The supplied Memo resource's
two-line text hit pane extends to `y=127.5`; candidate hit panes begin at
`y=121`. Skipping disabled candidates therefore allowed a click in that shared
strip to move the underlying Memo caret. Pointer routing now returns the
topmost visible control with its disabled state, blocks text selection beneath
it, and separately prevents held activation. The resource regression covers
that overlap through frame 15 in both aspect ratios and verifies that
candidate input resumes on update 16 without moving the Memo caret first.

### Held candidate arrows and scalar completion

USA 4.3 callback `0x8142D824` accepts fresh trigger event 4 only when the trigger
word equals A (`0x800`). Continuing-hover event 2 requires the held word to equal
A, no fresh A bit, and a 16-bit hover counter whose remainder modulo 20 is
**nonzero**. The branch at `0x8142D9B8` returns when that remainder is zero.
Successful input requests Pushed, then parent vtable `+0xE8` for previous or
`+0xE4` for next (`0x8142A9CC`/`0x8142A934`). This is separate from Memo's 60/20
text-scroll repeat and must not be converted into an every-20-update timer.

The parent `+0x104` check reaches the embedded `UITextArea` animation's active
byte through `0x81422D80`, `0x8142CE9C` and `0x8141F304`. Active movement blocks
another page request. `Scalar::start` (`0x81420C58`) initializes frame zero and
duration 15; `Scalar::calc` (`0x8141F32C`) checks the previous frame before
incrementing. It therefore remains active at frame 15, clearing on update 16.
`CandidateBox::calc` (`0x81429694`) runs that scalar before reading its offset.
IPL's `0x8135563C` runs keyboard calculation before its pointer pass. Continuing
hit handling increments the counter (`0x81445F64`) before event 2; fresh press
resets it at `0x814465A4` before event 4.

An earlier probe executed unchanged callback, scalar and counter routines
with synthetic UI objects. Sixty-four input/gate cases cover both arrows,
modulo boundaries, A/B combinations, focus/departure, moving-strip, window
transition and disabled state. Two held sequences advance the original scalar
and hover counter in that source order and obtain page requests at logical
updates 0, 16, 32, 48, 64, 81 and 97. Layout lookup, window status, and animation
and page requests are explicit host callbacks; this does not execute the whole
native menu, candidate geometry or a physical controller.

The earlier execution probe is no longer included. A fresh native capture is
still needed for aligned visual acceptance.

The browser now retains the frame-15 input lock and uses a dedicated candidate
hold controller with that counter condition. It preserves the arrow's focus
through paging, keeps the hit owner during movement, stops on release, real
departure, disappearance, blur or disposal, and leaves text uncommitted.
Existing Memo, Letter, Address and Settings owner forwarding uses the same
`holdControl`/`releaseControl` contract. Both scene and Settings candidate-arrow
IDs participate in host hover reconciliation. Original-resource regressions
cover both aspects, the executed request sequence, fractional versus batched
updates, reverse direction, bounds and lifetime.

A retained browser inspection used the original English dictionary with synthetic
prefix `th` and the `combined-memo-merge-candidates` source snapshot. A 91-update
Next hold requested pages at 0, 16, 32, 48 and 64 before reaching the final page;
a Previous hold requested 0, 16, 32, 48, 64 and 81 before reaching the first page.
The inspection retained 182 frames and sound-request metadata at
`artifacts/browser-qa/candidate-held-ui/audit.json` (captures
`1789985243601-b46d75ce` and `1789985259817-1a880524`). The F8 hover capture
`1789985285621-608b3655` retained all nine candidates without a stray keyboard
texture. This checks the running browser and its logical update cadence;
physical Wii-controller timing and aligned native/browser captures remain open.

`0x81429FB8` and `0x81429E8C` select/deselect temporary input previews. Hover
therefore changes the displayed text and caret without saving a draft change.
Original focus and pressed BRLANs remain independent of list movement. The color
initializer `0x81427F44` and draw path `0x8141FE24`–`0x8141FF10` establish typed
composition red `(255,50,50)`, selected completion green `(50,100,50)` and
unselected completion gray `(192,192,192)`.

Memo auto-scroll at `0x81443410` keeps the caret midpoint inside a two-line
editing window. It moves whole line increments over 15 updates. Display-mode
arrows at `0x81442208` and `0x8144231C` move three lines over the same curve.
`0x81443EC8` and `0x81443ED0` bound movement to zero through rendered line
height times line count minus 100. The original four-strip minimum remains in
the sheet. Physical Up/Down uses the same original font metrics as wrapping and
caret drawing. Original arrow groups retain their own appearance, loss, focus
and selection resources. Native capture alignment remains required for these
new visual paths, including the empty four-strip sheet.

## Settings text-field bounds

`0x81427E1C` stores the row limit and disables wrapping for a single-line
field through vtable slot `0x104`, which resolves to `0x81427E14`. Row-limit
checking at `0x8142706C` uses scaled glyph advances and the original word-wrap
hook. The browser uses the same bitmap-font measurements for accepted input,
line wrapping and caret movement. Single-line fields scroll horizontally;
multiline fields reject input beyond the configured row limit.

The generic form's `0x81420B90` and `0x81420CA8` scroll vertically by whole line
increments over 15 updates, using the constant at `0x81694D88`. The browser
keeps text and its caret inside the original field clip, including during
keyboard entry/exit, and clamps an active movement when deletion reduces its
bounds. Arrow appearance, disappearance and focus use the original textbox
BRLANs. Pointer-held arrows now use the verified repeat path described below;
aligned native visual acceptance remains open.

## Original dictionary evidence and current implementation

The supplied WAD includes both the language dictionaries and their executable
algorithm. `0x81333318` loads these original USA archives:

| Archive             | Original members                                                    | OEM word counts      |
| ------------------- | ------------------------------------------------------------------- | -------------------- |
| `eZTSystemNA.arc`   | `eZTSystemENAM.zsd`, `eZTSystemFRCA.zsd`, `eZTSystemESSA.zsd`       | Packed system tables |
| `eZTNintendoNA.arc` | `eZTNintendoENAM.znd`, `eZTNintendoFRCA.znd`, `eZTNintendoESSA.znd` | 869 / 1007 / 973     |

The original OEM callback at `0x81433A50` reads a big-endian word count and
offset table followed by null-terminated UTF-16BE words. The system-table reader
at `0x8145F1E0` reads 32 pairs of 24-bit count/flag and offset fields. Counts are
table-specific; the exporter does not mistake format flags for byte lengths.
Preparation validates these containers and exports user-owned raw dictionaries,
metadata and decoded OEM words into ignored assets.

The browser uses the exported OEM word lists through its first-party predictor.
Each editor owns isolated prediction state. This path keeps typing and
suggestions available in static builds, with no install-time dependencies.
It does not reproduce the original compressed-table ranking order.

Earlier analysis of the supplied USA 4.3 executable identified initialization
`0x8147C7C4`, search order `0x8147A5F8`, OEM attachment `0x81484D2C`, and
candidate lookup `0x8147A530`. The context is `0x1B44` bytes. The Latin path
includes `0x81465C0C` and compressed-table matching and ranking routines. The
single-phone-key wrapper reads the 52-byte key records at `0x81660AB8`. These
findings were bounded to executable SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
The former optional emulation worker was removed with its third-party runtime;
its old probes are historical evidence, not runnable checks in this repository.

## Remaining limits

The [coverage inventory](keyboard-coverage.md) maps identified menu fields and
reachable commands to their implemented owners and bounded remaining work.

Native Zi8 candidate ranking and acceptance are now an explicit fidelity gap.
The verified executable profile is USA 4.3. Remaining menu-wrapper command variants, held candidate-arrow capture acceptance,
telephone preview acceptance, Mii attachment and non-US key layouts remain
incomplete or unmeasured. Browser sessions retain first-party predictor state
and do not reproduce native engine RAM or a native learned-word store. The
traced USA Latin lifecycle
and remaining same-scene acceptance are recorded in [dictionary-state.md](dictionary-state.md);
durable learning is not presumed to exist without a native writer/loader.
Physical held-pointer cadence and red-caret pixel geometry still need aligned
browser/native capture acceptance.

Tests cover restricted Settings controls, physical-key isolation, Unicode,
Shift release, dictionary locks, original dictionary execution, stale asynchronous
queries, telephone composition, candidate clipping and previews, Memo scroll
bounds, original sound identifiers and font color/caret behavior. Passing these
tests does not establish frame-by-frame or sample-by-sample equivalence.

## Keyboard interaction corrections (September 2026)

The secondary layout's delete and line-feed windows have no independent tracks
in `fs_VK_cellPhone_a_Focus-IN`, `Focus-OUT`, `Pushed`, or `Roll_over`.
They now bind the original `W_CPkey_00` pane/material prototype, matching the
ordinary telephone keys. The retained BRLYT places delete, line feed, keytops and
mode tabs in separate branches under `N_CPkeytop_all`. Focus promotion walks
that ancestor chain without changing transforms, so an enlarged key can draw
above the selected mode tab. Selected telephone mode tabs ignore focus entry and
exit; activation still plays their original 20-update blue pushed resource and
settles back to the selected pose. This differs from the separately verified
QWERTY/telephone toolbar choice, which ignores a repeated selected press.

The More popup's previous/next buttons start with alpha zero in the BRLYT. Its
appearance/disappearance resources animate the shared Close prototype, and the
SGN focus resources provide the matching hover and pushed poses for all three
More controls. The browser binds the previous/next buttons to those shared
resources before either button is hovered. Tests check their initial
visibility, shared fade, independent focus, and Wii Menu footer page cue.

Composition now records a start position when a non-whitespace character is
typed with prediction already enabled, including digits and symbols. Enabling
prediction does not retroactively mark existing text.
Turning it off, accepting a candidate, selecting a language, or moving the
insertion point commits the composition; backspacing committed text does not
restart a dictionary query. The first matching candidate supplies the gray
completion suffix, while pointer candidate previews use the verified green
color. Enter commits active composition without adding a newline; subsequent
Enter input can insert a line feed. Asynchronous candidate requests retain their
generation checks. Restored preferences contain the supported UI choices described
in [dictionary-state.md](dictionary-state.md), never the user's draft or an
unfinished composition.

Fresh targeted executable inspection confirmed the accepted Enter path at
`0x8141D5D4` requests sound 9 and inserts character `0x0A` when appropriate.
The ordinary insertion tail at `0x81421C68` distinguishes `0x20` (Space),
requesting sound 9 rather than the character-input sound 10. The dictionary
insertion path at `0x814219D0` also commits its delimiter and requests sound 9.
The existing IPL callback maps sound 9 to `WIPL_SE_CHAR_DECIDE`. Both layouts and
physical Enter/Space now select that cue; rejected insertion still emits only
`WIPL_SE_CHAR_DELETE_ERROR` under the documented browser arbitration rule.
These control-flow findings establish cue selection, not sample-level AX mixing.

Memo exposes the original `P_txtScrll_UP`/`P_txtScrll_DOWN` and matching bounds
while editing. Their appearance, focus, press and disappearance resources are
bound separately from the display-mode `G_ArwR`/`G_ArwL` bubbles. Editor arrows
move one ruled line; display arrows retain three-line paging. Focus and press
use independent clocks, so accepted or rejected repeat presses do not restart
pointer focus. A manual scroll keeps its chosen viewport until subsequent caret
input. Opening the editor resumes automatic following of the insertion point.
The native bounds and 15-update curve remain unchanged. Pointer-held repeat is
source-derived below; controller-button integration and aligned native arrow
captures remain unaccepted.

Memo and standalone Settings text hit testing uses the rendered pane's display
projection, its complete ancestor transform and the font's exact glyph caret
positions. It clamps to UTF-16 code-point boundaries and ends active composition.
The rendering caret is suppressed immediately when keyboard dismissal starts.
The separate Console Nickname HTML selection is owned by the Settings surface,
not by that insertion point. The original `Nickname/Nickname_set.html` has an
ordinary centered `INPUT#Name`; `Nickname.css` supplies the original 36px bold
font, and clicking the input requests form ID 1. Raster serialization does not
retain a focused browser input's selection. The bridge therefore measures the
clicked glyph boundary using that input's loaded font and supplies a stationary
one-raster-pixel black marker. It remains outside the cached page raster and has
no path into software-keyboard caret state. Settings completion removes it
synchronously before drawing the first dismissal frame, independently of
asynchronous HTML rasterization. This implements the user's observed marker
behavior; its exact native height and pixel alignment still require a retained
native comparison. The independent red caret continues to follow text editing.

Prediction text layers previously deep-copied the complete archive animation
table each frame. They now share immutable metadata and copy only mutable panes
and materials. A local Node microbenchmark with prepared USA 4.3 resources,
30 warmed samples and alternating QWERTY-key focus measured median controller
advance/presentation time of 23.76 ms before and 4.27 ms after, with p95 values
29.87 ms and 6.20 ms. The comparison changed only that copying operation. This
is a controller-allocation measurement, not an end-to-end browser latency or
GPU/CPU utilization claim.

Remaining keyboard acceptance includes aligned native captures for these visual
changes, the black Nickname marker's native pixel geometry, line-feed glyph
presentation, red-caret raster thickness, dictionary label clipping, physical
controller repeat, and all supported language/composition boundary cases.

## Red caret and held text scrolling

USA 4.3 `inputform::Base::drawCursor` at `0x81420500` reads red `(255, 50, 50)`
from `0x81694D6C`, offsets the top and bottom by two units, and uses the font's
height for its endpoints. Its width argument is the truncated byte value of
`14592 / projectionWidth`. `textinput::debug::drawLine` at `0x81445904` converts
that argument to sixths of a unit and emits a centered quad. It does not snap
fractional glyph coordinates. The browser now uses this centered strip instead
of the former right-extending two-unit rectangle. Proportional glyph advances
change its center without changing its width; the same metrics locate wrapped,
explicit-newline and scrolled pointer selections.

`calcCursorTimer` at `0x8141F3B0` adds eight per update. `drawCursor` uses
`SinFIdx(timer * 256 / 360)` and truncates `127 * (1 + sin)` to an alpha byte.
The browser consequently has a continuous 45-update opacity pulse rather than
the former 30-on/30-off toggle. Parent pane opacity still multiplies the pulse,
and dismissal removes the caret immediately. Native sine-table interpolation
and final antialiased raster coverage still require a pixel comparison; the
browser uses `Math.sin` without claiming bit-identical lookup-table rounding.

Memo's event handler `0x81444330` first calls the generic text-form handler
`0x814274B0`. For `P_txtScrll_UP` and `P_txtScrll_DOWN`, the latter accepts the
A trigger immediately, then requires held A, the same pointed component and a
hold count of at least 60 divisible by 20. `GUIComponent::onTrig` at
`0x814465A4` resets this counter. The browser's pointer-held text arrows now
activate on pointer-down, repeat after 60 updates and every 20 thereafter, and
stop on pointer departure, release, cancellation, focus loss or scene closure.
Focus and press clocks remain separate. Large or fractional browser update
steps split at repeat boundaries so each line's existing 15-update movement
finishes before the next repeat. The generic directional helper `0x81426B1C`
instead uses a 30-update delay and nine-update repetition; those constants are
not substituted for pointer-held text scrolling.

Regressions exercise centered thickness at fractional proportional-glyph
positions, caret opacity and pane alpha, multiline selection after transforms
and clipping, repeated Memo movement and sound counts, departure/release, and
cancellation during a large update. These establish controller behavior and
source-derived geometry, not frame-aligned native visual acceptance.

## Held Backspace and QWERTY Space

USA 4.3 ASCII callback `0x81415994` permits continuing-hover event 2 to repeat
only `P_key_DELETE`, `P_Gkey_DELETE`, `P_key_SPACE` and `P_Gkey_SPACE`.
Telephone callback `0x8141B55C` permits `B_CPkey_DELETE` and `B_spaceBT_JP`;
the Japanese Space pane is hidden in the supported USA Latin layouts and is
not exposed by this change. Both callbacks require held A (`0x800`), no fresh
A trigger, and the button's pressed-owner check (virtual `+0x28`). The hover
counter must be at least 30 and divisible by nine. Because fresh press resets
it to zero, the first repeat is update **36**, followed by 45, 54 and so on.
Ordinary letters, Return, modifiers and telephone multi-tap keytops do not
enter this repeat branch. Fresh B remains limited to the separately verified
telephone reverse-cycle path.

Every accepted repeat requests the original Pushed state and forwards parent
event 4 exactly as a fresh A press does. ASCII dispatch `0x8141342C` reaches
common dispatch `0x814103CC`: delete command 1 resolves through `0x8165CA8C`
to `0x8141D2E0`. That handler uses the active editor buffer; the WithZi branch
calls virtual `+0x5C`, `0x81434088`, to shorten the current composition and
update candidates. There is no separate held-delete commit. Space similarly
uses the existing command-2 dispatch at `0x814104A8`, so the browser repeats its
ordinary Space insertion after ending the current composition.

An earlier execution probe ran the unchanged original ASCII
and telephone callbacks for 204 synthetic cases: source pane whitelist,
29/30/35/36 and nine-update boundaries, fresh A/B, held A/B, and pressed-owner
gating. It also ran the original button counter setter. Layout lookup,
pressed-owner/counter lookup, animation requests and parent command dispatch
were host callbacks; the probe did not execute the editor, complete UI loop,
physical controller or a native capture.

The third-party emulator and this probe have been removed from the project.

The browser's dedicated keytop predicate shares only the 16-bit hover clock
with candidate arrows. `holdControl` creates the pressed owner with one
immediate primary action. Existing host pointer capture suppresses the later
click, and release, departure, blur, another control, popup, layout change or
editor disposal ends the hold. The active owner forwards the same lifecycle
through Memo, Letter, Address and Settings. Resource tests cover both aspect
ratios, numeric fields, composition correction, Space commit, fresh-press
reset, batched/fractional updates and adapter closure. These establish source
and runtime logic; a native held-key capture comparison remains open.

The retained browser check used snapshot `combined-contacts-held-keys` (121
source files). A 91-update Space hold and a 91-update Backspace hold each
requested actions at 0, 36, 45, 54, 63, 72 and 81. Seven spaces were inserted
and exactly seven removed, restoring the original text and caret; release
produced no further action. The 182 frames and request metadata are retained
at `artifacts/browser-qa/keytop-held-ui/audit.json`, captures
`1789986086178-41beb231` and `1789986103546-af7cb7b7`. These are browser logical
update and pointer-routing checks, not measured physical Wii-controller cadence.

## Native 32-unit composition boundary

The ordinary input path `0x81421458` checks WithZi's virtual `+0xE4`
(`0x81420488`), which reads its unsigned UTF-16 input count at `+0x88`.
Instructions `0x81421700`–`0x81421798` leave 32 units active, then dispatch
Base command 6 before the following character. Command-table entry
`0x8141DB54` reaches `0x81420F30`: it inserts the active WithZi string into
the committed buffer and clears candidates. The input path restores case,
inputs the new unit, requests sound 9 (`CHAR_DECIDE`), and refreshes. The
ordinary below-boundary path requests sound 10 (`CHAR_INPUT`). This is the
editor's boundary, distinct from the larger wrapper buffer limit.

The committed string is not necessarily the raw input prefix. WithZi virtual
`+0xE0` (`0x81434188`) returns candidate `+0x98` in full. `WithZi::update`
(`0x814344C4`) resets that index to zero; candidate hover command `0x16`
reaches `0x81424350` and setter `0x8141EA80`. The boundary therefore preserves
a selected completion's suffix before starting the next composition. No
separator is added.

The earlier probe executed original Base input, active-buffer choice, commit,
WithZi input/update/clear and count routines. Twelve cases cover English,
French and Spanish with QWERTY and telephone input: 31→32 stays active;
32→33 dispatches command 6, commits, clears and starts at one. A separate
synthetic candidate fixture selects a longer string and verifies that its
entire suffix is committed. That fixture proves the dispatch contract; it
does not assert that the injected long word exists in an original dictionary.

The earlier execution probe has been removed with the optional emulator.

Browser input below the boundary remains immediate. At the boundary only,
typing waits for the matching prediction request, commits its selected full
candidate, then replays accepted typing and subsequent editing commands in
order. Backspace therefore removes the newly typed unit, including when the
committed candidate has a longer ghost suffix. Caret selection, layout and
prediction changes, blur, and normal Back/OK/Escape do not discard already
accepted typing. A normal close stops accepting new gestures while its earlier
edits settle; the Memo draft owner receives the completed text before closing.
Old-request candidate actions are disabled during this wait, so a result
arriving one microtask before settlement cannot replace newer accepted input.
External disposal invalidates the owner and its pending work immediately.
Field-limit rejection retains the active text and emits the existing error cue,
while still processing subsequent editing or close commands. This is an async
host adaptation to the native synchronous query, not an additional native state.
If a predictor call fails, the browser retains already typed literal text and
continues input without inventing a dictionary result.

Resource regressions cover both input layouts, 31/32/33 and repeated segments,
selected ghost completion, retained text after the caret, pending/stale
responses, ordered editing and close, external disposal, field-limit rejection
and unavailable providers. A real Memo owner regression types across a pending
boundary, presses Backspace and Back, then reopens the completed draft. Two
pending segments also preserve later caret edits and normal closure.
Only sequential key input is covered: the keyboard API does not invent a
native clipboard/paste operation.

Retained browser inspection `artifacts/browser-qa/composition-boundary-ui/audit.json`
uses source snapshot `combined-dictionary-boundary` (122 files). Its empty Memo
sequence types 32 `a` units, `hel`, then another 29 `a` units and `wor`. The first
and second boundaries commit at input ordinals 33 and 65, with exactly two
`CHAR_DECIDE` requests among 67 input cues. The active suffixes subsequently
show original `help`/`hello` and `work`/`world` predictions; console errors are
empty. Captures `1789987007855-9f738f33`, `1789987020307-ebdecb0f`,
`1789987039836-c11438fb`, and `1789987057187-b17fd528` retain the 32-unit,
35-unit, second pending, and 67-unit states. This capture predates the ordered
editing correction above: it proves the browser boundary sequence, not rapid
Backspace/close ordering or a native scene comparison. Full native scene
capture and unsupported non-Latin mode behavior remain open.

A later delayed-response browser check uses source snapshot
`combined-thumbnail-boundary-ordering` and holds the length-32 prediction response
for 3000 ms in an isolated fixture. Physical input `a` × 32, `x`, Backspace and
Escape reaches the pending close within 2.6 seconds. The controls lock while
that ordered close waits; settlement closes to the complete 32-character Memo,
and reopening retains those 32 characters. Captures `1789988134239-0185b731`
and `1789988166279-d62727b6` retain the closed/reopened states. This is a host
latency/ordering check, not a claim that the original native dictionary is async.

## Conditional native text-point continuation

The text callback `0x814274B0` dispatches fresh-A command `0x0E`, held-A command
`0x10`, and release-A command `0x0F`. Base table `0x8165CA8C` maps these to
`0x8141DD04`, `0x8141DEE4` and `0x8141DE44`. The latter two first call buffer
virtual `+0x78`, which reads byte `+0x20` at `0x8141EA64`, and return immediately
when it is clear. Buffer reset `0x8141F474` clears the whole word `+0x20`.
Fresh press changes the caret through `0x8143337C`, requests cursor sound 5,
and dispatches command `0x0C`. Its Base table entry only refreshes; inspected
ASCII (`0x81413B00`/`0x8141079C`), phone (`0x814199B0`) and prediction
(`0x81428420`) command observers do not enable the flag for command `0x0C`.

An earlier execution probe ran the unchanged Base dispatcher,
buffer reset, caret methods and flag methods for 24 literal-pointer cases,
covering Base dispatch, `LayoutByNW4R::onCommand` (`0x81426C80`) and the
Memo/Letter editing dispatcher (`0x8144133C`). With
the reset flag, press moves to index 1 and both hold and release remain at 1.
A diagnostic call to selection-start `0x81433394` sets the flag and anchor;
then hold moves to index 4, repeated hold at 4 does not repeat the cursor cue,
and release moves to 5 and dispatches `0x0D`. That diagnostic state remains
active after Base release; it is not evidence of a reachable scene lifecycle.

The third-party emulator and this probe have been removed from the project.

The probe's layout hit test, origin, field bounds/timer, sound and refresh
callbacks were synthetic, and the Base observer list was empty. Its layout cases
executed the original IPL delegate: menu creation `0x81354F94` passes the callback
to manager constructor `0x81437558`, which stores it at manager `+0x30`; Memo
construction `0x8143C910` passes that through `0x81425560`/`0x81436034` to field
`+0x22C`. Vtable `0x81638E3C` supplies no-op `0x81335CBC` and command callback
`0x81354D20`, which only handles request `0x25`. It does not enable the flag.

Normal manager binding `0x81437A50` first resets the form's observer list, then
registers manager slots `+0x10`, `+0x14`, `+0x18`, `+0x20`, `+0x28`, and `+0x2C`:
physical keyboard, ASCII, phone, prediction, language and symbol controls.
The physical keyboard, language and symbol `onCommand` slots all resolve to
no-op `0x81430800`; the three other observers are identified above. None enables
selection for the press's command `0x0C` or clears it on release command `0x0D`.
The generic outside-pane path near `0x814269A4` is gated by the same flag; its
held branch cannot establish ordinary Memo auto-scroll while dragging.

Within this audited ordinary binding and reset path, fresh-point caret placement
is supported, while continued dragging remains unproven. A full native scene
capture or an identified reachable flag writer is required before extending that
conclusion to every profile/lifecycle. No unconditional browser held-pointer
behavior or selection-range rendering is added. Existing pointer-down caret
selection remains in place.

Fresh pointer input has a separate composition branch at `0x8141DE0C`.
While WithZi owns input, the first press requests sound 9 and command 6, accepts
the full selected completion and clears composition. It does not evaluate the
clicked position. A later fresh press places the literal caret and requests
cursor sound 5. Eighteen additional original-code probe cases covered both Latin
keyboard layouts and three clicked positions through all three dispatchers.
They injected the synthetic selected candidate `hello` at index 1 and verified
`abYZ` at caret 2 becomes `abhelloYZ` at caret 7 regardless of the first point;
the second press then used that point. These brought the probe to 42 cases.

The browser applies this branch only to pointer-originated caret requests.
Programmatic caret placement and ordinary literal clicks keep their existing
behavior. A pending dictionary result retains subsequent typing, deletion,
another click and normal closure in event order, using the same queue as the
32-unit boundary. Resource regressions cover those pending paths, and Memo,
Letter and prediction-enabled Settings owner tests verify the first/second-click
distinction with original font metrics in both aspect ratios. The probe used
synthetic point measurement and candidate data; native scene timing and held
selection activation remain outside its result.

## Original WithZi editor analysis

Earlier original-code analysis covered `WithZi::init` (`0x81433D00`),
`inputChar` (`0x81433F40`), `backSpace` (`0x81434088`), `update`
(`0x814344C4`), `getPredicted` (`0x81434140`) and `clearCandidates`
(`0x81433D8C`). The original wrapper has a case-mode field at `+0xA0` and a
telephone key-record pointer at `+0xA4`. The browser's first-party word-list
predictor implements supported text entry and suggestions without executing
those instructions. Candidate order and case behavior therefore need fresh
native/browser comparison before an equivalence claim.

Candidate layout event `0x101` at `0x8142AD78` sends Base command `0x15`.
The command table at `0x8165CA8C` resolves that command to `0x8141E010`, which
calls `getPredicted`, inserts the returned UTF-16 string, then clears candidates.
`Decolated::inputString` at `0x81432F50` iterates exactly that string. This Latin
path adds no trailing space and has no special branch for the one-key `>`
candidate. The browser inserts candidates verbatim. An earlier bounded
original-code run produced `>` for selection zero after telephone key 6; the
prepared word-list path does not claim to reproduce this candidate order.

An isolated browser check exposed a pointer-order bug: the underlying Memo
text pane consumed candidate presses. Pointer routing now gives the last-drawn
enabled control precedence over text selection; the resource/renderer
regression verifies `hello` followed by `x` and caret index 6. These checks do
not establish full native UI timing or all wrapper modes.

`WithZi::confirm` at `0x8143412C` branches to `update`; it is not evidence for
a persistent learned-word store. `setCurrentWord` (`0x81434ED4`) appends to the
63-unit wrapper context buffer at `0x810C81F0`; the update path attaches that
buffer and additional flags for specific modes. The command-0x15 path invokes
that context update only for native input type 8, outside this Latin harness.
`Zi8SetHighlightedWordW` (`0x81465260`) also mutates engine context, including
the string at offset `0x187A`. The browser does not retain that RAM, and its
predictor state establishes no durable native learning format. The follow-up
[state and persistence audit](dictionary-state.md) identifies an
eight-byte saved preference record and confirms bounded Latin query writes stay
in working memory. It establishes no durable learned-word format to implement;
other region executables remain outside this analysis until independently mapped.


## Memo reader arrow ownership

The posted-Memo reader shares the original Memo display-arrow appearance,
focus, departure and press resources through `createMemoScrollArrows`. A scroll
leaves the hit region enabled and preserves pointer focus while the independent
press animation runs. Additional triggers during the existing 21-update
300-unit movement are rejected; reaching a bound starts the original arrow
loss resource and removes that direction's control.

Reader input differs from the keyboard editor. USA 4.3 reader event handler
`0x8139B698` handles pointer events 1/2 through `0x8139AC70`/`0x8139ADF4`, and
trigger event 0 only after controller vtable slot `+0x18` checks `downTrg` with
mask `0x100800`. `0x8139AF08` checks Scroller activity via `0x813976D4` before
starting its press animation and movement. There is no held-A repeat in that
handler. The separate directional-button path at `0x813987B0` reads held input
through slot `+0x14` only when the scroller is idle. Therefore the reader's
pointer hold starts one movement; the editor's verified 60/20 repeat is not
applied to it.

Regressions sample actual rendered arrow opacity, retain the hit region during
movement, reject overlapping triggers without restarting the tween, preserve
hover after release, clear it on departure/blur, hide it at a bound, and reset
it when reopening. These establish source-derived controller behavior; aligned
native/browser reader-arrow captures remain open.

## Visible line feeds and remaining label checks

The supplied USA 4.3 executable's `textdrawer::Base::draw` at `0x81435408`
handles stored UTF-16 `U+000A` at `0x81435560`: it saves the current text color,
sets RGB to 200 while retaining alpha, prints original glyph `U+E056`, restores
the color, then dispatches `doLineFeed`. `inputform::Base::doLineFeed` at
`0x8141FC7C` increments the line count, advances Y by the form's line height,
and resets X to the form origin. This was checked in unchanged executable
bytes with DOL SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
The original Type1 Rodin and Type2 Utrillo fonts both contain `U+E056`.

Editable multiline text now draws that original gray marker at each explicit
line ending. Automatic wrapping draws no marker. The marker is decoration:
storage still contains a newline, and glyph layout, character limits and caret
indices do not count an additional character. Closing the Memo input form
removes the decoration from the ordinary Memo display. Physical and onscreen
Enter both insert a line feed when no composition is active, with prediction
either enabled or disabled. Enter during composition commits its text; a
subsequent Enter inserts the line feed. Regressions cover these paths, explicit
versus automatic wrapping, alpha, and removal of markers after editing closes.
Native/browser pixel alignment of the new marker remains to be captured.

The English dictionary label audit uses the layouts' original Type1 font.
ASCII `T_USEU_prdc_lang` measures `Eng` at 43.5 units in a 117-unit pane;
telephone `N_prdc_EU_lang` measures approximately 56 units in a 64-unit pane.
A renderer regression verifies all three glyphs, the complete original `g`
texture rectangle, and its descender inside each authored pane. No arbitrary
pane or glyph expansion is applied. A visual report of any remaining clipping
still needs a reproduced screenshot before changing the original metrics.

The More window's appearance and focus bindings were also checked through the
renderer hierarchy. Both page-arrow bodies appear on the first visible update,
retain the original material opacity through hover/departure and page changes,
and return to their complete idle poses. The close button and both arrows use
the original SGN focus resources, and page changes request the same `WSD_SELECT`
cue as the Wii Menu footer instead of the keyboard-layout switching sound. These are
resource/controller regressions, not aligned native capture acceptance.

## September 21 integrated UI check

An isolated synthetic Memo fixture exercised the multiline reader and keyboard
through the normal menu. With predictions disabled, Return displayed the original
gray newline glyph; with an active `he` composition, physical Enter committed
black text and cleared candidates without a line break. A subsequent on-screen
Return with prediction enabled and no composition inserted the glyph and a line
break. Closing the keyboard removed the decoration and retained separate lines.
Both More arrow bodies were visible at rest on pages 1/10 and 2/10. The complete
Eng label, including the g, was visible in QWERTY and phone layouts. Reader arrow
controls survived their scroll tween, retained the bubble after a click and
cleared it on pointer departure. The browser error log was empty.

Private module hashes and observations are retained in
`artifacts/browser-qa/keyboard-reader-ui-audit.json`. The browser capture provider
produced cropped/tiled images, so this run establishes exercised UI states, not
pixel equivalence or physical held-input cadence. Preference schema v2 was
updated after this run and is validated separately.

The later `combined-secondary-erase-v10` browser fixture exercised forced
Address profiles and return to Memo. Wii Number displayed the three original
separator bars, accepted 16 digits and rejected a seventeenth; e-mail forced
QWERTY without dictionary controls. Returning to Memo preserved telephone ABC,
prediction enabled, and More page 3/10. With the logical animation clock paused
to isolate the 90-update timeout, fresh secondary click on ABC inserted `2`,
and the next replaced it with `C` at the same caret. Secondary Backspace left
the text unchanged and requested only pointer focus. The original prediction
and animation settings were restored without saving a contact or posting a
Memo. Eight local captures and exact runtime hashes are listed in
`artifacts/browser-qa/keyboard-preferences-ui/forced-profiles-and-secondary.json`.
This confirms exercised routing and preference isolation; forced-profile
native pixel comparison remains open.

That check also exposed the telephone/numeric Backspace extending beyond the
viewport. A source sanity check reproduces this from the raw hierarchy:
`N_CP_del_all` X=263 plus `W_CPkey_DELETE` X=1 and half-width 58 gives right
edge 626 in a 608-unit viewport, or 856.63 in wide projection width 832.
Type 12 delegates the numeric configuration and adds textbox separators at
`0x8143CEF0`; examined telephone create/reset/language/numeric routines do not
establish a correction to that parent X value. No arbitrary translation is
applied. Direct re-parsing of `layout/common/sofkeybd.ash` matches the exported
geometry, and the supplied resource archive has no English keyboard-layout
overlay. None of its telephone animations targets either that parent or
`N_CPkeytop_all`, ruling out an omitted translation track on those panes.
Native layout-level transform/capture verification remains required.

## Memo editor scroll and pointer regression corrections

The longer-draft regression exposed a distinction the initial adapter missed.
Display mode's maximum at `0x81443ED0` is the ruled body height minus 100;
editing uses the two-line window configured at `0x81442D50..0x81442D88` and
whole-line auto-scroll at `0x81443410`. The native float constants used here
are one half, two, and fifteen updates. Clamping both modes to the display
maximum put a six-line editor at offset 152, partly underneath the prediction
strip. Its correct whole-line editing endpoint is 168 for 42-unit line spacing.
The editor now uses actual text lines for that range, preserves manual Up/Down
until another caret edit, and animates deletion back to a complete line.

The original constructor at `0x81441814..0x81441884` retains separate
`T_2l_TextBox` and `B_2l_TextBox` panes. Its calc routine expands the boundary
pane with the text height (`0x81442B30..0x81442BA0`), preserving the top edge.
In editing mode, the two-line text window cancels the content scroll offset
(`0x81442D50..0x81442DD0`). The browser now uses these separate panes for
pointer bounds and the original glyph layout for the insertion index. This
removes the obsolete 149-unit hit limit that rejected visible text after
manual scrolling. Candidate controls still own clicks over the sheet.

The display-mode input command at `0x814414A8` handles command `0x0E`, derives
the clicked line from the pointer, and supplies that location to the editor
opening path. Clicking an unposted Memo therefore opens at the clicked
character rather than always moving to the end. Letter uses the same command,
calc, cursor-position and auto-scroll functions: its vtable at `0x816689D0`
contains `0x8144133C`, `0x81442A3C`, `0x814436BC`, `0x814414A8` and
`0x81443410`. It uses the same corrected hit-window/opening behavior.

Pointer capture introduces a separate host event: releasing capture can emit a
DOM leave although the pointer remains inside the scroll button. Memo, Letter
and Settings text arrows now use the existing explicit arrow-retention rule:
reconcile against the current rendered bounds, preserve focus through the
click, and clear it on real departure or removal at a scroll bound. Tests use
resource-rendered arrow bounds and verify the complete hover pose survives
press/release before leaving. This is a browser input adaptation; it does not
claim a new native animation interval.

Regressions exercise closed-draft insertion, selection on the fifth and sixth
source lines after manual Up/Down, dictionary-strip clearance, deletion across
a newline, whole-line endpoints, empty-editor bounds, and Letter's inherited
behavior. Full native/browser motion alignment remains an acceptance step;
these checks establish the reported state and coordinate corrections.

A subsequent browser check found the closed eight-line draft still opened the
keyboard when clicking the bottom-position Up button. Its focus animation expands
the hit pane into the broad text opener, which was appended later in the DOM.
The Memo control list now appends arrows after the text opener, matching Letter's
existing order. The regression uses the actual source panes after hover, verifies
their overlap, follows the host pointer-selection precedence, and scrolls the
closed draft without opening a keyboard. This control-order correction does not
change the native panes or their animation.
