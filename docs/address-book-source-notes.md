# Address Book executable evidence

The Address Book uses original USA 4.3 `th_Adress_a` resources and a local contact
fixture. Page geometry and state transitions below were recovered from the
supplied executable. They are implemented and regression-tested. The bounded native comparisons
below constrain cover geometry, entry and return; full visual and timing
equivalence remains unproven.

## Page stacks and wrapping

`Address::draw` at `0x813822DC` does not draw the authored book tree once. It
repeats page panes in this order:

1. Right sheets `N_note_a`, from the right-page count down to one.
2. Current face `N_note_b`.
3. Turning sheet `N_note_c`, only during ordinary forward/backward turns.
4. Left sheets `N_note_d`, starting at zero, or one during an ordinary turn.
5. Cover `N_note_e`, placed after the left stack.

The right-sheet loop is at `0x81382364`–`0x813823EC`; the remaining draw sequence
starts at `0x813823F0`. Initialization at `0x81382804` sets right count 20 and left
count zero. `0x813873F4` initializes the displacement vector to (−1, −1), using
−1.0 from `0x816947E8`. The browser repeats those original panes, retaining their
materials, authored rotation and native draw order. The stacks change thickness
as sheets move between sides.

`next_page` at `0x81385940` subtracts a right sheet and moves the book base before
a normal forward turn. `prev_page` at `0x81385C14` subtracts a left sheet before
a backward turn and restores the right sheet after it finishes. During reverse
turns, the underlying face retains the old page while the turning sheet carries
the destination page. The browser now preserves this distinction.

`add_vec2` at `0x81384074` scales the base's X movement by standard projection
width divided by current projection width: 608/832 in widescreen. Y remains one
unit per sheet. Individual sheet offsets do not use that extra ratio.

The last page advances to the closed cover and the cover can move backward to
page 20. These are separate native states, at `0x81383048` and `0x813831D4`.
The draw loop at `0x81382524`–`0x81382594` repeats `N_note_e` nineteen times,
at offsets one through nineteen, during wrap states 7/8. The browser previously
emitted only one cover in those states; it now preserves the complete loop.
Ordinary states still draw a single cover after the left stack. Forward and
backward pages retain their original BRLAN timing and zero-slope rotation curves.

## Sheet edges and original framebuffer

The sheet placement helper at `0x813443E4` writes X/Y from the supplied vector
and explicitly resets Z to zero. The caller at `0x813823B8` supplies the
right-stack displacement; the left/cover paths use the same helper. Adding
arbitrary per-sheet depth would contradict this observed operation.

Original `W_note_a` and `W_note_d` are window panes using `th_frm_b.tpl`, a
16×16 IA4 texture. Their frame materials interpolate from white to
RGB (123,149,151), with independent texture alpha. The right page has zero
content inflation; the left page has three units on each side. These exact
resources remain unchanged in the adapter.

Fresh native cover frame 13758 in `artifacts/captures/address-settings-16x9`
shows thin bright lines along the left stack, while the long bottom stack is
largely solid. A direct 836×456 browser raster loses the left lines. Rendering
the same unchanged resources at 640×456 restores them: the one-unit horizontal
sheet offsets occupy less than one framebuffer pixel in the widescreen
projection, exposing different portions of the white/teal border texture.

This framebuffer size is independently verified in the original executable:

- Mode records at `0x81634FA8` and `0x81634FE4` both contain framebuffer width
  640, EFB height 456 and XFB height 456 at offsets +4, +6 and +8.
- Video initialization at `0x8133E00C` selects those NTSC interlaced/progressive
  records. The aspect setting changes the VI width; it does not change their
  framebuffer width or EFB height.
- The main viewport call at `0x81334CBC` reads those +4/+6 values and supplies
  origin (0,0), near zero and far one to `0x81547F2C`. That helper stores the
  viewport fields later emitted to XF register `0x101A` by `0x81547E9C`.

The display adapter therefore exposes a 640×456 framebuffer independently of
the 608×456/832×456 logical projections and CSS output aspect. Mouse coordinates
and clipping still use the logical projection. No sheet spacing, texture or
material values were altered to recover the lines.

A bounded comparison of native frame 13758 and the direct/640-pixel candidates
is recorded in the local `analysis/address-sheets` report. The cover's left-edge
RGB mean absolute difference falls from 13.30 to 8.13. Across all 245 measured
rows, the white face's thresholded envelope matches native columns 224–621;
page one's envelope also matches (223–620), with left-edge RGB difference 8.43.
`tools/reference/compare_address_edges.py` reproduces these bounded metrics from
aligned PNGs. The narrower raster restores the missing structure, but the exact
brightness/phase of every line still differs. GX subpixel rasterization, texture-coordinate precision and
native presentation filtering require further aligned analysis. This finding
does not establish full-frame pixel equivalence or validate every turn frame.

The standalone `/address-inspect.html` renders a selected stable page or turn
update at explicit output dimensions through the original framebuffer. Its
stack-only option excludes face and cover without changing original resources.
Save exports only the presentation canvas through the local capture API. Query
parameters mirror controls (page, turn, frame, aspect, width, height, stack-only);
`native-raster=0` enables the old direct-output diagnostic and `save=1` also
exports after loading. These are browser candidates, not native reference images.

## Sound and interaction ownership

The Create Message selector opens Address in native mode zero. Initialization
at `0x81382804` branches on the mode field at +0x88: this route uses only
`note_alp_in`, not `note_trns_in`. On Back, `0x8138563C`–`0x81385684` starts
the selector's `AdressOut` and the child's `note_alp_out` concurrently with the
footer Back press, then queues footer operations 0x10/0x0B (disappear both,
appear left). The parent completion path is `0x813C34C4`. Fresh native entry
frames 13237–13259 and exit frames 25048–25095 in the same Address/Settings
recording constrain this route. Other entry modes retain their distinct
translation behavior and should not be inferred from the Create route.

`Button::calc` at `0x8139C2B0` clears its busy state on a separate update;
a queued text reservation also occupies one update. Entry therefore runs
left-out at 0–13, the Register reservation, then both-in at 15–28. Exit starts
the parent/child zoom with the press at 0–20, followed by both-out at 21–34
and left-in at 35–48. The adapter retains the current page's rotation and
stack offsets during shrink. Cover exit ordering is constrained by the fresh
capture; page-one exit has controller regression coverage but no native
comparison yet. Detailed evidence is in the ignored recording's
`analysis/address-transition-evidence.json`.

The parent and child have distinct update boundaries. `SceneManager::calc`
at `0x8140A71C` traverses existing scenes at `0x8140A738` before consuming the
creation queue at `0x8140A7AC`; the later attachment path is `0x8140AF80`.
Create's request at `0x81409E88` uses the queue writer at `0x8140B048`.
The prepared browser child therefore retains its invisible frame-zero pose for
one update after selection, alongside its arrow entrance. The parent selector
can already advance. Native loading/readiness may add further waits, which this
prepared-resource path does not simulate.

On return, Create's layout calculation runs in the common-before hook at
`0x813C288C`, whereas Address calculates its layouts in common-after at
`0x8138229C`. `FaderSceneBase::calc` at `0x8140B254` places those hooks before
and after the state update. Back starts the parent animation after its earlier
layout calculation, so the selector retains its initial exit pose for one
update while the child advances. Fresh matched images show these opposite
one-update offsets; the implementation preserves them without changing the
28/48-update enclosing footer queues.

Both page arrows now animate with entry and exit. Initialization at
`0x81382A20`/`0x81382A2C` starts common-button operations 23/24. Back's common
tail at `0x81385754`–`0x81385768` starts operations 25/26 immediately, alongside
the book shrink. The operation table at `0x8160F7B8` maps these to
`10150`–`10160` and `10100`–`10110`, respectively. Dispatch at `0x8139CB58`
also retires hover and disables the departing arrow controls. The adapter
previously forced the appeared endpoint throughout the parent transition,
skipping entry and leaving arrows visible until the entire footer queue ended.
The original `G_ArwRoop` interval `10000`–`10055` now also animates the Address
arrows continuously through focus and page actions. Its scene-local clock does
not yet preserve the native common footer's absolute phase across every scene
switch; exact loop-phase alignment remains open.

The explicit page cues are `WIPL_SE_FL_PAGE_INC` and `WIPL_SE_FL_PAGE_DEC`, called
at `0x81382B00` and `0x81382D68`. Hover uses the original common-footer focus
animations. Page turns preserve hover until pointer departure; leaving the book
retires it. The Create controller owns its selection
and return sounds, preventing an extra generic host click from playing over them.

Offline Register retains the original WiiConnect24 gate. Optional registration
forms store local contacts; they do not implement WiiConnect24 or reproduce its
network state machine. Their surrounding animation sequence remains less verified
than the book page controller.

## Registered contact actions and local mutation

### Local registration review and acknowledgement

The explicit local registration flow now proceeds from the address and nickname
forms through the optional Mii form to the review card. Original dispatch at
`0x8138B09C` writes messages 85 and 139 for the Mii form. With no local Mii
records, its action opens the existing message-380 notice and leaves the form
intact; it does not create a populated selector. Back returns through nickname
and address editing while retaining the draft.

The review branch of `0x8138B6C4` starts card entrance, resets the three action
button scale clips, and writes message 68. State 34 uses the common footer
(`0x8138B9F8`) and the address-value pane; Send, Change Nickname, Erase and an
invented separate Save button are absent. The local review likewise keeps those
buttons hidden and uses the common Back/OK controls. Clicking the value opens
the complete address notice; Back restores the optional Mii form.

Review OK starts `card_fnsh` alongside the common-footer press. Original state
35 at `0x8138BA68` waits for the outgoing card, calls storage at `0x8138D530`,
then opens message 74 with OK at `0x8138BB34`. The acknowledgement state at
`0x8138BC54` waits for the dialog before returning to the book. The browser also
waits for successful local persistence before displaying that notice. Pending
storage locks controls, failure restores the review and its values for retry,
and a disposed owner ignores late completions.

Resource and Create-owner regressions check hidden button ownership, the
optional no-Miis branch, reverse editing, common-footer timing, the 19-update
card departure, asynchronous success, acknowledgement, persistence failure and
single retry. These establish the local state and resource sequence; native
capture alignment and populated-Mii registration remain unverified.

### Letter recipient mode

`createLetterRecipientPicker` wraps the shared Address Book page controller in
its explicit `recipient` mode. This is a local fixture, with no network lookup.
Existing local contact records are selectable by default; an optional boolean
`confirmed: false` models an occupied registration-pending slot. It does not
assert that the console's discontinued registration service confirmed a contact.
The standalone controller supports that field; host persistence must explicitly
preserve it before relying on it across reloads.

The USA 4.3 LetterWriter entry at `0x813C0824` opens Address scene `0x14` in mode
one for its text route. Address initialization at `0x81382804` uses
`th_Adress_a_note_trns_in` and `my_Dialog_a_DialogIn`, with message 78 in
`T_Dialog` (the instruction to choose an address). The latter animation is bound
to pane `N_Top`, as recorded at `0x81381BC0`. The book starts closed. Once the
entry finishes, a nonzero occupied count dispatches state zero at `0x81382074`,
which opens the cover through the ordinary `note_e_rtt` path. An empty book stays
closed; sparse contacts do not cause a jump to a later page. The 20 pages and
their wrapping, stack geometry and original page cues are shared with normal
Address mode.

Eligibility at `0x81385448` requires an occupied slot with native status two.
Text mode accepts Wii and email recipients. Photo mode additionally restricts
the kind and remains outside this controller. Empty rows are inert, and an
occupied pending row shows original message 87 with OK. The pending row's
`gry_name_in` animation is reset at frame zero by `0x81384124`, retaining its
RGB 200 idle material; it does not play the hover endpoint. Recipient mode has
no Register action, contact action card, nickname editor, deletion or dragging.

The selection branch at `0x813847D0` starts footer operation 12, reserves Quit
and Send (messages 37 and 51), queues operation 15, and retires both page arrows.
After the 17-frame name press, `0x81383260` copies the selected contact through
LetterWriter's virtual method at `0x813833BC`, then starts the 17-frame book
translation out and 26-frame prompt departure. The browser callback waits for
both book/prompt and footer completion. `onSelect(contact,
{ footerAlreadyEntered: true })` tells its host to inherit the established
Quit/Send footer when constructing the composer.

Back is a separate cancellation. `0x81385688` starts its press concurrently with
the book/prompt departure, queues footer operations 12 then 11, and retires the
arrows. The wrapper retains the full 49-update press/out/in queue before
`onCancel`, without choosing or changing a contact. Disposal silently suppresses
either pending callback. The host draws this wrapper's footer once and delegates
input while it is active; the parent Create selector retains ownership of its
own Letter entry/return animation. Native scene-loading delays and exact
parent/child scheduling still require a matched capture; controller tests do
not establish frame-for-frame visual equivalence.

### Duplicate registration and pending contacts

AddressData's duplicate check at `0x8138E620` dispatches by contact kind.
`0x813870B8` scans all 100 occupied slots of Wii kind and compares the stored
64-bit number. `0x81387124` scans occupied email slots and calls the byte-exact
comparison at `0x81602480`; it performs no case folding. Both include pending
contacts. Completing the address keyboard reaches `0x8138A948` for Wii or
`0x8138A9A8` for email, showing original message 82 or 83 with OK when a match
exists. The acknowledgement handlers at `0x8138AAC0`/`0x8138AB20` return to the
address state, leaving it editable. The browser preserves that draft, keeps
the form's OK unavailable while it duplicates an occupied slot, and permits
progress after correction. Existing duplicate records are not removed or merged.

A pending contact's management card remains accessible, but its Send action
does not enter the composer or network checks. The pointer trigger at
`0x8138CB88` tests native status two; the other branch at `0x8138CBF0` opens
message 87 and OK immediately. It does not play the eligible Send press or
decision cue. Hover handling at `0x8138C6DC` also requires status two before
playing Send focus. The explicit local `confirmed: false` fixture now follows
these branches in both recipient selection and the contact card.

The gray Send artwork is the authored `N_crd_btn_gry` branch, using the same
message 42 as normal Send. Animation registration at `0x81388774` binds
`btn_scl_in/out` to `crd_btn_gry`. Initialization at `0x81388D4C` resets the
inactive branch's scale-in clip to zero and the active branch's scale-out clip
to zero. The adapter uses those source poses; the gray branch also participates
in card-button departure and restoration around Erase. Synthetic regressions
cover immediate pending notice, absence of Send/focus cues, immutable original
resources, duplicate/correction, exact email case and preservation of sparse
contacts. Native/browser comparisons remain unpaired for these new branches.

### Registration validity and the optional console fixture

Registration now follows the original Address predicates without applying them
retroactively to saved contacts. The numeric field requests profile 12 and
requires sixteen digits. `0x8138E470` passes its decimal value through
`0x8138708C` and `0x8134209C` to `0x814ADFAC`. The transform at `0x814AE130`
masks to 53 bits, XORs `0x5e5e5e5e5e5e`, rotates right one bit, permutes and
substitutes six bytes, rotates left ten bits, and XORs `0xb3b3b3b3b3b3`.
Polynomial division by `0x635` must leave a zero remainder. The browser uses
BigInt so sixteen-digit input is not rounded by floating-point conversion.

The original predicate rejects the console's own number and, when its decoded
type is zero, a recipient whose decoded bits 47–49 are nonzero. These checks
require a known console identity. The optional `ownWiiNumber` in the version 1
local message fixture supplies that identity explicitly and displays it on the
Address cover. It defaults to null; no identity is read from a NAND, inferred
from another contact, or fabricated from the cover's placeholder. A configured
value must itself pass the checksum. Without it, new registration still checks
the number's format and checksum, but own-identity and type compatibility are
unknown.

The keyboard completion branch at `0x8138A91C` checks own number first (message
86), then occupied-slot duplication (82), then number validity (84). Email
duplication (83) precedes email validity (446). Each notice uses original OK
message 46 and retains the editable draft. Empty and canceled keyboard results
do not open a validation notice. The form's continuation uses the same policy;
direct controller submission cannot bypass it.

The email predicate at `0x8138807C` accepts printable ASCII in the local part,
except `()<>[]:;` plus backslash, comma and quotation mark. Its nonempty domain
accepts ASCII letters, digits, hyphens, underscores and dots, but no leading,
consecutive or trailing dot. A domain need not contain a dot. The initialized
mail-domain constant at `0x8166D6DC` is `@wii.com`; the original comparison
rejects that domain without case sensitivity. Other address comparisons stay
byte-exact. The library accepts up to 255 bytes; this registration field uses
profile 7's narrower 99-unit limit. This reconstruction implements the reachable
ASCII field rules and original initialized domain, not arbitrary NWC24 service
configuration or a general-purpose Internet mail validator.

An isolated original-code audit matched the compact numeric transform on 4,096
deterministic inputs and checked 256 checksum cases. Its script, executable hash
and synthetic results are retained under
`artifacts/browser-qa/address-validation-source/`. Generated payloads 1, 2 and 3
produce `7053433507880718`, `8742285515623182` and `8179332609414415`; these are
unassigned structural fixtures, not identities extracted from consoles or
proof that an address was issued. The earlier `1234567812345678` fixture fails
the original checksum and remains useful only as a legacy stored-contact test.
Existing contacts still display, permit nickname changes, and send local
Letters under their previous storage contract. No contact is removed by this
upgrade. Service-driven confirmation and external registration remain outside
the local fixture; these predicate checks are not native/browser visual parity.

A later isolated browser run checked original invalid-number message 84,
own-number message 86, and a generated valid recipient advancing to Nickname.
It also checked message 446 for `a@WII.COM` and successful continuation for
`a@b`. Both registrations were canceled, the optional own-number fixture was
restored, and no browser errors were observed. Eight retained captures and the
loaded source hashes are recorded in
`artifacts/browser-qa/address-validation-ui/audit.json`. This verifies local
interaction and preserved state; the rejection transitions remain unpaired
with native captures.

USA 4.3 AddressEdit creation at `0x81388490` binds the original `th_Adress_b`
card clips. The settled primary, secondary and lower buttons use messages 42
(Send Message), 43 (Change Nickname), and 47 (Erase). The prior local adapter
displayed address editing on the primary button and erased immediately. It now
implements the verified offline Send branch and the original confirmation flow.

The choice dispatcher at `0x8138967C` waits for the selected `btn_psh` clip.
When Internet configuration is absent, the Send path at `0x81389A20` calls the
two-button Internet dialog with messages 324, 326 (Enter Settings) and 37
(Quit). The browser reuses that existing original dialog; Quit returns to the
same contact, and Enter Settings uses the existing settings boundary. Selecting
the card's Mii control uses the native empty-Mii result, message 380 and OK,
from the Mii availability branch at `0x813899A0`. This fixture has no Mii
records and does not fabricate a populated selector.

The fifth card hit target is `B_card_beta`, confirmed by the pointer table at
`0x81647F24`. Its hover/press clips bind `T_frnd_crd_00` directly; it is not a
layout group. The adapter uses the shared pane-binding helper so these clips
leave the other card buttons untouched. The supplied clips contain no matching
address-pane transform tracks; their bound duration is retained without
inventing a scale effect. Choice 4 at `0x81389C28` opens the
original one-button dialog with the address value and OK. The original number
formatter at `0x8138E470` inserts spaces between four groups of four digits.
For email, `0x8138E394` shortens the card label only when it exceeds sixteen
UTF-16 code units, keeping the first fourteen followed by three periods.
The value helper at `0x81389C68` returns the full email or grouped Wii Number
to the dialog, so the abbreviated card never replaces the saved address.

Nickname editing at `0x813898B4`–`0x81389964` writes message 50 (Nickname)
to `T_question_00`, the current name to `T_name_00`, and message 73 (Apply
nickname) to `T_msg_00`. The local adapter keeps changes in a draft until the
form's OK action. Back restores the saved card; confirming changes only its
nickname. Existing contact kind and address remain intact.

Erase follows these original resource boundaries:

1. The card's 21-update `btn_psh` finishes, then its three action buttons play
   the 11-update `btn_scl_out` clips. Native dispatch is at `0x8138967C`.
2. `0x81389D70` writes message 48 (Erase this?) on the card, starts the
   21-update `card_msg_alp_in`, and invokes `0x81346F8C` with No, Yes and true.
   That helper uses `my_DialogWindow_b` and hides `N_Top`: the question belongs
   to the card. The helper's first label targets `T_BtnB`, the second
   `T_BtnA`, so Yes is on the left and No on the right. Its original
   `DialogIn` lasts 26 updates. Background card/footer controls are unavailable.
3. The confirmation uses the original 21-update `SelectBtn_Ac` and 26-update
   `DialogOut`. The result dispatcher at `0x8138A024` erases only for result 2
   (Yes); No fades out the card question and restores its buttons.
4. The accepted path fades out the question and opens message 81 (That Wii
   Friend has been erased.) with OK at `0x8138A0EC`. The original one-button
   layout supplies its 25-update entrance, 17-update selection and 21-update
   exit, followed by the card return.

The confirmation helper's sound at `0x8163597B` is
`WIPL_SE_INFO_WINDOW`; the adjacent focus cue is `WIPL_SE_BT_TARGETTING`.
These original symbols are used directly. The local controller preserves the
phase boundaries when several updates are advanced together and prevents a
newly created dialog from advancing before its creation boundary.

Native deletion at `0x81386F84` clears the selected occupancy byte and decrements
the entry count; it does not shift every later friend. Accordingly, the browser
stores an empty slot as `null`, preserving later contacts' pages and positions.
Registration reuses the first empty slot within the original 100-entry bound.
Existing contiguous contact arrays still work. The existing browser-local
`wii-menu.contacts` value holds these records; this change neither reads native
console contacts nor introduces network delivery or a different storage backend.

A full managed book still accepts Register. Its native footer trigger reaches
`0x81385FE8` through `0x81385788`–`0x813857A8`; after the service checks,
`0x813861A4` compares the occupied count with 100 and opens message 80 with OK
(46). The local controller uses the original `my_DialogWindow_a1` notice and
retains the book, page and all slots until acknowledgement. Pending contacts
count as occupied, while a `null` slot permits registration even in a 100-slot
array. The default offline gate still takes priority, recipient mode has no
Register action, and an outstanding contact save keeps input ownership.
Fifty-four focused Address, Create and recipient-picker regressions cover
these boundaries, unchanged contact data and the original dialog resource.
This branch has not received a paired native/browser timing capture.

`contact-storage.js` validates the existing array before reading or saving it:
at most 100 slots, `null` for an empty slot, supported kind/address fields, a
nonempty nickname of at most ten UTF-16 units, and an optional Boolean
`confirmed`. Additional JSON metadata is preserved. Invalid saved data is left
untouched and does not become a writable empty baseline. A changed storage
value from another tab is rejected when observed before saving; this is a
stale-snapshot check, not a cross-tab transaction lock.

Registration, nickname changes and accepted Erase call `onContacts(next)`
before replacing the controller's records. A thrown error or rejected promise
keeps registration/nickname drafts available and restores the erase card without
the success notice. A pending promise locks mutation controls, and disposal
suppresses late scene callbacks. `onContactsError(error)` lets the host display
the failure. The host returns `saveContacts(next)` directly instead of the
generic storage helper that logs and swallows storage errors; parent adapters
also retain their previous contacts until that save succeeds. These persistence
waits and recovery paths are local safety adaptations, not additional native
animation evidence. Synthetic tests cover quota failure/retry, malformed data,
sparse/metadata preservation, stale snapshots and pending callback disposal.

Controller regressions cover both confirmation results, the precise mutation
boundary, success acknowledgement, empty-Mii dismissal, nickname cancellation,
sparse reload and empty-slot reuse, modal input ownership, dialog draw order and
unchanged imported resources. Full address display also covers both formatting
branches and isolated pane focus. Tests use synthetic contacts only.

An isolated full-application browser smoke also checked Send → Internet gate →
Quit, nickname form title and Back cancellation, Erase → No, the empty-Mii
notice, and the grouped Wii Number dialog with OK. The ignored evidence file
`artifacts/browser-qa/contact-fixture-audit.json` records the loaded source-module
hashes and test limits. Browser smoke did not accept Erase; isolated controller
tests cover its commit and sparse-slot behavior. No existing user contacts were
changed, and this smoke is not a native/browser image comparison.

A later isolated browser check injected one contact-save failure, retained the
editable nickname draft, then accepted a retry and confirmed the changed nickname
survived reload alongside the other synthetic contacts. The source hashes and
capture limits are recorded in
`artifacts/browser-qa/contact-save-failure-ui/audit.json`. A separate check of the
next source snapshot confirmed the gray pending Send pose, original message 87
with only the notice cue, and duplicate e-mail message 83. Dismissing the duplicate
notice retained the editable address and left continuation disabled; registration
was canceled without changing the Board or outbox. Its retained frames and source
hashes are recorded in `artifacts/browser-qa/address-registration-ui/audit.json`.
These checks use synthetic contacts and are not paired native captures.

These are source-derived local branches, not a matched native contact sequence.
Exact common-footer reservations around modal changes, additional native
registration states, populated Mii selection, and contact dragging remain incomplete or
unmeasured. Readable-file contact export remains separate work. Letter selection
retains the original offline Internet gate by default. An [explicit local Letter
fixture](local-letters.md) now connects a known contact's Send Message action to
the original text composer and a local outbox, and supports the source-backed
recipient picker. Populated Mii and outbound photo/attachment flows remain
incomplete; no letter or attachment is
transmitted. Native/browser capture comparisons are still required for the
newly implemented contact routes.

## Inactive contact-move overlay

The authored book tree also contains `N_note_move → N_base_move → mii_move`,
a separate sibling of the book body. Address creation at
`0x81381F48`–`0x81381F6C` finds `N_note_move` and calls `0x81344414` with false;
the helper clears bit zero of the Pane flag byte at +0xCF. A separate draw pass
at `0x8138261C`–`0x81382664` may draw this branch in eligible interaction states.
It is not part of the ordinary page body's `G_note_all` fade.

The adapter previously kept its authored visible flag. The inactive Mii
placeholder therefore remained beside Memo after the book faded, until the
48-update footer queue released the Address child. The adapter now restores
the original hidden state. Renderer traversal tests cover every entry and exit
update for the cover and page one, a page turn, and settled holds through 300
updates. Contact dragging is not implemented; its overlay must be explicitly
owned by that future state. Original resources are unchanged.

The earlier full-sequence exports below predate this visibility correction.
Their selected comparison regions exclude the affected middle band, so their
bounded metrics remain useful; their complete images are not the latest source
revision. Follow-up evidence is recorded separately with new authored hashes. Both corrected
cover and page-one exits have complete 49-pose browser exports; the cover exit
also has a fresh comparison against the same native interval. In the separately
reviewed 31×46-pixel public silhouette region, mean absolute RGB error falls
from 29.714 to 3.321. The main application was also checked through both returns;
the silhouette is absent. A separate translucent native indicator near x293,y215 is excluded from this
measurement and remains unidentified. Residual error includes background
sampling differences; this is not a claim of exact pixel equivalence.

## Separately calculated sheet opacity

The fresh transition exports exposed another difference: while the book bounds
matched, the browser cover was too translucent and the underlying page number
showed through it. The original sheet draw operations explain the discrepancy.

`Pane::CalcMatrix` is virtual slot `+0x10` in the table at `0x81671704`, resolving
to `0x8151F210`. It retains the parent's global matrix at
`0x8151F334`–`0x8151F350`, but opacity comes from the supplied `DrawInfo`.
At `0x8151F42C`–`0x8151F4E4`, an alpha-influencing pane temporarily multiplies
`DrawInfo+0x4C` for its children and then restores that value and the influence
flag. This temporary opacity is separate from the parent matrix.

Address redraws `N_note_a`, `N_note_d` and `N_note_e` using a fresh call to that
virtual method at `0x813823BC`, `0x813824AC` and `0x813825E0`; the wrap cover
loop does the same at `0x81382564`. These calls occur after the whole-tree
calculation has restored `DrawInfo`. The directly drawn `N_note_b`/`N_note_c`
faces retain the whole-tree opacity calculation.

The renderer's scoped `alphaContextRoots` option models those boundaries without
changing parent transforms, external scene opacity, resource flags or sheet
textures. Address marks only its repeated a/d/e roots. At the half-fade pose,
the cover and repeated sheets receive one factor of 0.5, while the ordinary
face receives both factors (0.25). Tests exercise that distinction through the
actual renderer traversal, including descendant influence flags and unchanged
geometry. This fixes the duplicate fade; it does not claim exact integer alpha
rounding or GX/VI sampling.

`tools/reference/compare_sequence.py` reads complete inspector sidecar manifests
and compares explicit browser updates to a selected native XFB interval. It
finds a minimum-error monotonic pixel correspondence, allowing repeated or
skipped native ordinals. There is no ordinal-to-update or elapsed-time
assumption. Comparison regions and exclusions are explicit; console-number
pixels, the native pointer and date are excluded from both measurements and
the generated contact sheets. The ignored capture's
`analysis/address-sequences` directory retains the manifests, region definition,
per-update CSVs and input hashes for this comparison. The final reports also
retain the authored renderer/controller hashes recorded at export time and the
analysis tool's hash, since resource identity alone cannot identify an
uncommitted browser revision.

Final exports include all 29 entry poses and 49 cover-exit poses. Across the
selected upper-book region, mean absolute RGB error (0–255 channel values) falls
from 1.328 to 0.687 on entry and 1.036 to 0.653 on return. In the selected edge
strips it falls from 7.500 to 2.289 and 7.331 to 1.391, respectively. Those strips
also contain moving selector artwork; they are not isolated arrow measurements.
The cover-exit upper-book error no longer has a mid-transition spike: its maximum
falls from 3.693 to 0.737. These metrics follow monotonic pose matching, not a
claim that each native PNG advances one update.

Some intermediate footer poses do not have close native presented counterparts.
The source queue durations remain unchanged. Entry's initial hovered-selection
state and the common arrow loop's global phase also differ. The ignored report
`analysis/address-sequences/README.md` identifies the final candidates, exact
regions, redacted contact sheets, revision history and all measurement limits.
A separate 49-pose page-one exit export provides browser regression evidence;
its final selected region equals the cover-exit endpoint, but this recording
contains no native page-one Back sequence.

## Validation limits

Regression tests traverse all twenty pages, both wrap directions, the nineteen
repeated wrap covers, stack counts,
base offsets, reverse labels, original page cues and hover-bubble retirement.
They also confirm that original imported resources remain unmodified. The earlier native recordings were deleted by the user and are not current
evidence. Fresh settled-cover and full entry/cover-exit comparisons above
identify concrete sampling, opacity and update-order corrections. Other animated
routes, both wrap directions, sound timing and residual pixel differences remain
open; no complete pixel-accurate result is asserted from tests or binary
inspection alone.
