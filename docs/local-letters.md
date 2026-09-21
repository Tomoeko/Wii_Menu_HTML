# Local Letter fixture

The default Letter service is offline. The Create selector's Letter button and
registered contacts' Send Message action retain the original Internet settings
gate. An explicit local fixture enables a text composer from either the Letter
selector's recipient picker or a known contact's Send Message action:

```json
{
  "version": 1,
  "letterService": "local"
}
```

Save this as `.local/message-fixture.json`, then reload the page. Use `"offline"`
to restore the default. Choose Letter, then a populated Address Book row, or
open the Address Book and choose a contact's Send Message action. The picker
opens page one automatically when any contact is present; an empty book stays
on its cover. It does not expose registration, contact editing or dragging.
Local contacts are selectable by default. An explicit `confirmed: false` in an
in-memory fixture shows the original registration-pending notice instead;
this local flag does not establish external registration or contact agreement.

To create contacts through the local Address Book form, also set
`"localRegistration": true` in that fixture. This optional Boolean defaults to
false and is independent of the Letter service. It enables the existing Wii
Number and e-mail forms and saves contacts locally; it performs no external
registration. Without it, Register retains the original Internet settings gate.

New registrations use the original Wii Number checksum and email syntax rules;
existing stored contacts remain compatible. Optional `"ownWiiNumber"` defaults
to null. A checksum-valid sixteen-digit string displays the explicit local
console fixture on the Address cover and enables own-number/type rejection.
For isolated testing, `"7053433507880718"` is a generated, unassigned structural
fixture; `"8742285515623182"` is a distinct compatible recipient fixture. Neither
number was obtained from a console, and passing the checksum does not establish
an issued address or external delivery. Omit this field to keep the console
identity unknown. See [Address validation evidence](address-book-source-notes.md#registration-validity-and-the-optional-console-fixture).

The composer uses the original Letter resources, shared software keyboard,
dictionary preferences, text selection, input newline markers and scroll
controls. Back or Quit retains a separate draft for that recipient while this
Create controller remains open; reloading or leaving the controller does not
persist these drafts. Canceling the selector route returns to Create, while
canceling the contact route returns to that contact.
The Mii control presents the original empty-Mii notice. The local controller
accepts a verified photo descriptor supplied by an importer or host; it has no
arbitrary URL/file picker.

Send writes to `.local/letter-outbox.json`. It never connects to Nintendo,
WiiConnect24, an email provider or the recipient's console. The recipient label
and original sending artwork describe the local fixture's animation; they do
not establish delivery. The outbox is readable, versioned JSON with a `letters`
array. Each record stores a request `id`, `recipient` (`kind`, `address`,
`nickname`), `text`, an `attachment` descriptor or `null`, and server-assigned
`createdAt`.
Keep this ignored local file private when it contains your own contacts or text.

The local server validates and atomically appends records under its shared JSON
writer lock. `GET /api/message-fixture` reads the service selection;
`GET /api/letter-outbox` reads saved local records; `POST /api/letter-outbox`
accepts a validated record only when the local service is enabled. Repeating the
same id and payload acknowledges the existing record, while conflicting reuse
is rejected. Back up the outbox by copying its file. Do not replace it while a
save is running. The shared writer's crash/recovery limits are documented with
the [other local JSON state](storage-fixtures.md); this is not a remote delivery queue.

The composer waits for both the original animation and local commit before
clearing the draft. The selector route then returns to the Message Board; the
contact route returns to the contact. A write failure leaves the
draft intact and surfaces a local warning. Retrying unchanged text reuses the
request id to handle a response lost after a successful commit; editing text or
opening a new composer starts a new request. Contact records are not modified
by composing or saving a Letter.

## Original source evidence

These observations use the supplied USA 4.3 executable and prepared original
resources. No binary bytes or analysis annotations were changed.

- `0x813C0478` initializes LetterWriter with message 139 (Add a Mii), 142
  (Write a message), and 143 (Sending message). It allocates a `0x800`-byte
  text buffer and a `0x400`-unit work object. The local fixture conservatively
  allows 1023 UTF-16 units, reserving a terminator; this is a local limit, not
  proof of the original editor's exact accepted maximum.
- `0x813C0824` opens Address child scene `0x14` for selection modes, or copies
  the chosen contact for the direct card route. `0x813C0B6C` replaces the ten
  placeholder characters in message 141 with the recipient nickname for
  `T_Header`. `0x81443D2C`, `0x81443D90`, `0x81443DF4` and `0x8144515C`
  identify the header, Mii hint, writing hint and sending text panes.
- `0x813C2D60` owns the selector's `LetterIn` transition. Address selection
  mode one owns the book and common footer; its departed child hands the
  composer an already entered Quit/Send footer. `0x813C3458` starts
  `LetterOut` on cancellation and exits Create on a successful result.
  `0x813C0F38` restores the Back-only footer for writer route zero using
  press 27, command 16, the Back-label reservation and command 11. The host
  waits for the child departure before starting a new child's clock; exact
  SceneManager/common-queue overlap still needs aligned native capture.
  The shared picker evidence and local confirmation semantics are recorded in
  [Address Book source notes](address-book-source-notes.md#letter-recipient-mode).
- The `sofkeybd/my_LetterL` package supplies the composer. Its `SendOut` lasts
  211 updates; the identically named Board reader resource lasts 63. The two
  resources must not be substituted. `0x81444EF4` selects the successful send
  action when the writer's flag at `+0x3F0` is set, and the ordinary exit action
  otherwise. MailIn/MailOut last 17 updates; ReturnIn lasts 19.
- Letter drawing at `0x81444A54` repeats `N_Body` once per four text lines;
  footer placement at `0x81444C5C` uses those 168-unit body sections. Memo
  instead repeats a 42-unit strip per line. A shared rendering helper preserves
  that distinction while reusing input-form keyboard motion and caret state.
- `0x813C154C` constructs messages for Wii recipients, with optional selected
  official Mii data. Only the photo route (`+0x1E8 == 2`) retrieves the existing
  Board image through `0x813935AC` and attaches it. `0x813C1890` uses a separate
  text sender for email recipients. These native transport functions are
  evidence only; the browser never calls them or emulates their network writes.

Controller regressions exercise cancellation, source-package duration, no early
completion, delayed and failed writes, unchanged retry ids, changed-text ids,
source immutability, body repetition, empty Mii and the UTF-16 bound. Existing
Memo tests cover the shared view extraction. The fixture is not a measured
native/browser Letter sequence. The Letter footer retains the completed common
Board-arrow exit on its independent `G_ArwL_End` and `G_ArwR_End` groups; rebuilding
the footer from its resource default had incorrectly restored visible arrows.
Focused selector tests also cover recipient identity, independent drafts,
entered-footer handoff, canceled departure, disposal and asynchronous Send.
Exact common-footer overlap, keyboard transitions, original service-error
branches and native capture alignment remain open. The local composer now opens
a bounded attachment picker whenever more than one verified photo descriptor is
available. It draws each prepared thumbnail, keeps the selection in the
composer, and sends only the selected descriptor. Populated Mii selection and
other attachment types remain separate incomplete branches. Sent local Letters
now reappear on the Message Board as read-only outbox records with their
recipient header, text and optional verified photo; they cannot be replied to or
erased through the incoming-letter route. Board writes filter these projections
back out, so posting a Memo or changing an incoming record never converts a
local send into an incoming Letter. The bounded incoming photo and local
photo-forwarding branch is described below.

An isolated browser smoke with two synthetic contacts exercised the original
empty-Mii notice, keyboard line-feed marker, accepted text, Back to the contact,
draft reopening and local Send. The reader returned to the contact without
browser errors. The isolated outbox contained exactly one matching two-line
Letter with no attachment. Local module hashes and assertions are recorded in
the ignored `artifacts/browser-qa/local-letter-fixture-audit.json`; this records
browser operation and local persistence, not native visual or delivery parity.

A subsequent selector run covered an empty Address cover, a populated first
page, the notice for a pending recipient, and the handoff to the Mail composer.
Quit and reopening the same recipient retained the two-line draft. Send added
exactly one record to the isolated outbox, preserved its two existing records,
and returned to the Board. The 281-frame Send sequence, source hashes, synthetic
contacts and assertions are retained in the ignored
`artifacts/browser-qa/recipient-picker-ui/`; no console warnings or errors were
observed. This establishes the local selector flow, with native alignment still
open.

## Incoming fixture presentation contract

`incoming-letter-fixture.js` validates a separate, explicit local fixture shape.
`incoming-letter-reader.js` provides its original-resource presentation. These
modules perform no file reads, network delivery, Board insertion or deletion;
the host owns import, persistence, photo preparation and child scene scheduling.

```json
{
  "version": 1,
  "letters": [
    {
      "kind": "letter",
      "id": "synthetic-incoming",
      "createdAt": "2026-01-02T03:04:05.000Z",
      "header": "Synthetic sender",
      "text": "A local fixture message.",
      "sender": {
        "kind": "wii",
        "nickname": "Synthetic",
        "address": "1234567812345678"
      },
      "photo": null
    }
  ]
}
```

The validator returns detached, whitelisted records, normalizes valid timestamps,
rejects duplicate ids and bounds the fixture at 200 records. Header and text
limits are 256 and 1023 UTF-16 units. Sender validation uses the existing local
recipient rules. A record requires text or a photo. These are local fixture
bounds, not a claim that every native message type has the same limits.

An explicit `sender: null` represents the native address type NONE. Omitting
`sender` remains invalid. A valid sender object may additionally use
`replyAllowed: false` to model a nonzero native no-reply flag. This optional
field must be Boolean; explicit `true` is removed by normalization, preserving
the canonical shape of older replyable records. Null sender with explicit
`replyAllowed: true` is rejected. Neither absent-address nor prohibited-reply
Letters expose a Reply control or dispatch a Reply action. Their text, photo,
Back and host-enabled Trash routes remain available.

A photo descriptor contains `id`, integer `width` and `height`, lowercase
`sha256`, and `localSrc` exactly `/assets/local-letters/<id>.png`. External URLs,
path traversal and query substitutions are rejected. The original attachment
path decodes a packed ODH image, reads its packed dimensions at header offset
4, and rounds each up to a multiple of eight before checking the 512×456 bounds
and producing RGB565. This fixture accepts an explicitly predecoded PNG within
1–512 pixels wide and 1–456 high; it does not decode ODH or claim to reproduce
its color conversion. Descriptor validation alone does not decode pixels or
verify their hash: the importing host checks the actual PNG dimensions and hash,
publishes that local PNG and preloads it. Its RGB565 appearance remains the
fixture author's responsibility.
Passing `photoAvailable: false` suppresses the photo artwork and hit target while
retaining the validated record and readable text after a missing-image failure.
There is no attachment picker or arbitrary URL loader in this controller.

To display the small photo on the Board card, optionally add a separate
`thumbnail` object inside `photo`. It has `width: 64`, `height: 48`, its own
lowercase SHA-256, and `localSrc` exactly
`/assets/local-letters/thumbnails/<photo.id>.png`. Supply that predecoded PNG at
`thumbnails/<photo.id>.png` inside the same `--photos` input directory. It is an
explicit fixture image, not a request to resize the full photo. The importer
checks both files' dimensions, hashes and PNG structure, publishes them without
replacing existing pixels, then commits the Board under its shared writer lock.
Incorrect, missing or conflicting thumbnails reject the import. A failed Board
commit may retain verified, reusable unreferenced images, as for full photos.

Existing photo-only records remain compatible and keep their card's photo group
hidden; their full reader photo still works. An imported Letter's metadata is
immutable, so a later import cannot silently add a thumbnail to that same record
identifier. Distinct Letters may share verified image assets. Erasing a Letter
keeps both shared full photos and thumbnails. `preloadIncomingLetterAssets`
deduplicates image requests before Board construction and reports independent
`unavailablePhotoIds` and `unavailableThumbnailIds` sets. A failed thumbnail load
hides only the card photo group; a failed full-photo load does not discard an
available thumbnail or the readable Letter. Browser texture caching is shared
across these records; it does not reproduce native heap-allocation lifetime.

The reader takes `origin: [x, y, z]` in the Board's logical coordinates and a
`measureTextLines` callback using the renderer's original font and wrapping.
Its fallback measurement counts explicit line feeds only. The host supplies
the original messages and reader/dialog layouts named by
`INCOMING_LETTER_LAYOUTS`; it must not substitute the software keyboard's
identically named Letter composer package.

For a replyable Letter in offline mode, Reply invokes `onServiceRequired` after
its button press. In local mode, `onReply({ recipient, recordId })` hands ownership
to a text-only composer addressed to the original sender. No quoted text or
attachment is invented. The reader withholds its controls and footer while that child owns
them; the host calls `resumeReply()` after cancellation or completion. A thrown
or rejected child-creation callback returns through ReplyBack and calls
`onReplyError`. Disposal and obsolete attempts suppress late failures. The host
must not advance a newly created child with elapsed time already consumed by
its parent. `dispose()` silently stops this reader and its owned sound;
`suspendAudio()` stops the sound without discarding the record. Photo Send remains
disabled. Trash is available only when the host provides the explicit local
erase callback described below; it is absent from the full-photo controls.

The native evidence is from the supplied USA 4.3 executable:

- `0x813944D4` selects `LetterS_b` for an ordinary incoming Letter from the
  table at `0x8164B4C8`; Memo keeps `LetterS_a`. At `0x8139476C`, incoming cards
  use the header, while Memo uses its body, before the shared six-unit preview
  formatter. A missing Mii leaves Nigaoe hidden. Native photo cards separately
  draw the decoded photo on a 64×48 logical quad and copy a 64×48 RGB565
  EFB rectangle (`0x8139521C`), then bind it to LetterPic. The optional explicit
  thumbnail fixture replaces only LetterPic's texture map zero. Without that
  prepared image, the card photo group stays hidden instead of displaying the
  resource's sample picture or claiming the full-size PNG is that capture.
  The full photo remains independently available in the opened reader.
- `0x81398EF4` chooses the Board reader package, binds Reply/ReplyBack to
  `G_Reply` and photo focus/zoom to `G_Pic`. `G_Reply` contains only ReplyMask;
  the photo transition must not move the Letter header or paper. The original
  reader repeats 168-unit body sections per four lines, including one section
  for an empty photo Letter.
- `0x813989F0` manually draws the reader, culling paper sections outside
  −500..500 before drawing text and `N_TopBtn`. `PicMask` and `N_Pic` follow
  the arrows, with `ReplyMask` last (`0x81398C04` onward). The browser retains
  their original ancestor transforms in a separate overlay pass. This trace
  does not establish an additional rectangular scissor; none is invented.
- The Board constructor sets scene flag `+0x28 = 2` (`0x8138EA78` onward).
  `Scene::draw` at `0x81409DBC` therefore continues drawing that parent while
  it has a child, unless its separate hide flag is set. Board drawing at
  `0x8138F514` calls the focused object's draw without a Reply-child exclusion.
  The original `my_LetterL_Reply` animates only `ReplyMask`, from alpha 0 to
  210 over 11 updates. The incoming text remaining faintly visible beneath
  the Reply composer is supported by this draw path; hiding all reader layers
  would discard the original parent contribution. SceneManager recursively
  draws the hierarchy in three passes (`0x8140A990`, `0x8140A9E8`). This is
  source evidence, not a measured compositing match.
- `0x8139A170` loads the 17-update linear position interval from `0x81694888`.
  It interpolates the card origin independently of SelectLetter/ExitLetter's
  BRLAN scale. Initialization starts both original arrow-loop bindings and
  plays `WIPL_SE_BOARD_SELECT` at `0x8139A1FC`.
- `0x813954E4` bounds the native ODH decoder and requests RGB565 through
  `0x8135B668` (identified by the original `decompressGbaOdh` diagnostics).
  The dimension readers `0x8135B640`/`0x8135B654` round up to multiples of eight;
  `0x81399FEC` fits the whole photo within the 412×309 Pic pane without crop.
  SelectPic/ExitPic last 14 resource updates and own `G_Pic`.
- `0x8139B87C` and `0x8139B8E0` start common Back press command 27
  (3000–3020) before ordinary exit or photo return. The original footer
  dispatcher `0x8139AAA0` selects appearance command 17 for a replyable Letter
  or 13 without Reply; `0x8139ABA4` selects departure 18 or 14 respectively.
  Commands 13/14 use 3600–3613/3620–3633, while 17/18 retain
  3640–3653/3660–3673. Opening reserves 9→17 or 9→13; closing reserves
  18→10 or 14→10. Photo entry runs the applicable departure with SelectPic,
  then reserves 15 and starts display-arrow departure; photo return reserves
  16→17 or 16→13.
- `BoardObject::permit_reply` at `0x81395E94` checks the header's unsigned
  halfwords at `+0x118` (address type) and `+0x11A` (no-reply flag). It returns
  true only when the former is nonzero and the latter is zero. Twelve isolated
  original-PowerPC cases and the original footer reservation table are retained
  in private `artifacts/browser-qa/incoming-reply-contract/native-results.json`
  and `native-bytes.json`. This verifies the predicate and reservation ranges,
  not full-scene timing, image equivalence or arbitrary native record import.
- `0x81397CE0` queues the Reply footer transition 18→15, changes labels to
  original Cancel/Send and requests child scene `0xB`. The local controller
  completes that 26-frame footer reservation before invoking its host callback.
  This is an explicit scheduling adaptation: the native child request occurs
  while the shared common queue runs. ReplyBack restores the reader mask and
  command 17 footer; shared native child/parent overlap still needs an aligned
  capture comparison.

Focused tests cover input validation, unavailable photos, source immutability,
photo/Reply pane ownership, independent position and footer clocks, arrow loop,
button locks, cancellation, asynchronous failure, disposal and scroll sound
ownership. This is source-backed controller coverage. Native/browser incoming
Letter capture alignment, populated Mii data, archive/channel attachments and
attachment sound remain separate work; local photo forwarding is covered by
the verified descriptor path.

## Erasing a local incoming fixture

Trash uses the original shared reader branch. `0x8139B914` accepts `B_Dust` only
in normal reader state 1, queues common command 28 (2800–2820), hides the text
arrows and plays `WIPL_SE_BT_PUSH`. The incoming footer then runs command 18
(3660–3673), or command 14 (3620–3633) when Reply is absent. After the common
queue empties, `0x81397768` opens the original
two-button dialog with message 64, “Erase this message?”, left Quit (37) and
right OK (46). Quit restores command 17 (3640–3653) for a replyable Letter or
command 13 (3600–3613) otherwise.

Acceptance at `0x81397964` starts `ExitLetter`, the independent 17-update return
position interpolation, common command 10 (3426–3439), and
`WIPL_SE_BOARD_DUMP`. The reader reports result 2 to Board `0x813910F4`, which
schedules its record erase task (`0x81391F24` → `0x81395EF4`). Reader completion
reports result 4; Board `0x813913DC` waits for that task before removing the
record object. The local controller likewise requires both visual exit and
durable commit before removing its card. Native SD-protected record classes
and their error dialogs are outside this ordinary local fixture schema.

The reader accepts `onErase(id)`, `onEraseError(error)` and `onErased(id)`.
The Board exposes this as `onEraseLetter(id)` and routes failures through
`onLetterError`. The main application serializes this operation after preceding
Board saves. `POST /api/message-board/erase-letter` accepts only
`{"version":1,"id":"fixture-id"}` and returns that identity plus an `erased`
boolean. It requires a local origin, rejects IDs owned by Memos, and treats an
already-absent ID as an idempotent success. The server uses the same validated
atomic update and process lock as imports and ordinary Board writes.

Ordinary `PUT /api/message-board` continues preserving omitted imported Letters;
a stale snapshot cannot implicitly erase one. A browser save carries its last
accepted base records: an unchanged stale copy of an explicitly erased Letter
stays absent, while an attempted edit conflicts instead of recreating it. Shared PNG
assets are retained, and deliberate reimport remains possible. On save failure,
the browser retains the Letter and scroll position, restores the reader footer,
and reports the error for retry. This failure recovery is a local storage
adaptation, not a measured native error transition. Focused tests use synthetic
temporary records and cover cancellation, both commit/animation completion
orders, locks, malformed data, stale saves, retry and disposal. A paired native
erasure recording remains outstanding.

The thumbnail trace distinguishes geometry from pixel equivalence. The packed
ODH decoder selects its RGB565 output mode at `0x8135B5DC`; the color converter
clamps channels to 0–255 and truncates them to 5/6/5 bits (`0x8135DC4C`,
`0x8135DDB0`). `0x813955C0` initializes the decoded image as a clamped,
non-mipmapped format-4 texture. Its texture initialization at `0x81545C70`
sets the original linear magnification/minification mode bits. The thumbnail
quad supplies complete 0–1 texture coordinates, independently of image aspect;
it does not use the large reader's contain-fit calculation.

That quad is drawn in a 608×456 projection (`0x8133594C`, used at
`0x81395228`). The ordinary NTSC viewport is 640×456 before the scene manager's
three draw passes (`0x81334CBC`, `0x8140A990`), and the Board renders thumbnail
captures in pass zero (`0x8138F514`). Its capture helper does not set a viewport.
With that viewport retained, a 64-pixel EFB copy covers 608/640 of the quad's
horizontal texture range. This consequence still needs a native state/capture
check before encoding it as a host resize or crop operation.

The copy helper at `0x8136339C` receives its preserve-filter argument as one
(`0x813952D4`), so it skips both copy-filter changes. It sets source and
destination to 64×48, destination format RGB565, half-scale off, and copies
without clearing the EFB. The active copy filter is inherited: video-mode
tables contain coefficients `[7,7,12,12,12,7,7]` for NTSC interlaced and
`[0,0,21,22,21,0,0]` for progressive, while other original capture paths can
change or restore that state. The per-photo path does not establish which
coefficients were active. EFB format, dither, pixel-center sampling and copy
rounding also need a matched native observation. A generic bilinear PNG resize
is therefore not presented as the original thumbnail, and the importer does not
generate one automatically. The explicit 64×48 fixture route binds only
LetterPic's texture map zero, preserving other maps, UVs and the original
N_Pic/PicBase/shadow transforms. In `LetterS_b`, N_Pic has translation
`[39.04545, 12.18182]`, rotation 8 degrees and scale 0.8; LetterPic remains
96×72 with scale 0.7 and complete 0–1 UVs. The layout's sole card hit target is
B_Letter, so this route adds no separate photo control.

The native creation branch at `0x81394984` allocates the separate capture and
enters state one. Board draw pass zero calls `0x813951F0` once and marks the
capture ready at object offset `0x128`. On the next update, `0x81394BBC` frees
the full decoded working buffer, binds LetterPic map zero from the capture,
then starts PasteLetter and enters state two. `0x813951CC` suppresses the card
while state one is pending; the original sample image is not displayed.
Cleanup at `0x813953D4` releases the capture with its BoardObject. The browser
preloads its explicit thumbnail before constructing the Board, achieving the
same no-sample-image boundary without inventing a native asynchronous delay.
Focused tests cover import failures, immutable shared assets, deduplicated
loading, independent missing-image recovery and unchanged original resources
through PasteLetter, focus and selection. Native thumbnail pixel sampling and
paired visual comparison remain open.

## Incoming browser check

The September 21 isolated browser run imported one synthetic Letter with a
512×256 checker image. It exercised reader entry, photo zoom/Back and one
incremental downward scroll, then opened Reply, typed two lines, canceled and
reopened the retained draft. Local Send returned to the reader and increased
the outbox from one record to two with exactly the expected recipient and text.
The entry/photo/scroll and 261-frame send sequences, source hashes and state
assertions are retained in the ignored `artifacts/browser-qa/incoming-ui/`.
No browser errors were observed. These checks establish the local flow; they
do not close native timing, filtering or attachment-format acceptance.

A separate thumbnail run used an explicit 64×48 fixture on the original angled
card pane and a distinct 512×256 full photo in the reader. It retained 182
entry/Back frames and five stills. Temporarily withholding the thumbnail produced
a recoverable notice, hid `N_Pic`, and left full-photo viewing functional; the
asset bytes were then restored. The pre-existing Memo and outbox remained byte
identical, with no browser errors. Evidence and the loaded source hashes are in
`artifacts/browser-qa/incoming-thumbnail-ui/audit.json`. This validates independent
local image ownership and recovery, not native GX thumbnail sampling or matched
native transition timing.

A later isolated synthetic erase run captured 91 updates through Trash → Quit
(`1789984176257-3a3867d5`) and 121 through Trash → OK
(`1789984239459-7edd0039`). Cancel restored the reader and both records; acceptance
left the original Memo intact. The outbox and prepared photo hashes remained
unchanged, and the recorded cue requests include `WIPL_SE_BOARD_DUMP`. Exact
source/state evidence is retained in
`artifacts/browser-qa/incoming-erase/browser-validation.json`. This verifies the
local browser operation without establishing native erasure timing equivalence.

The non-replyable fixture browser check retains five captures and a source-hash
report in private `artifacts/browser-qa/incoming-reply-contract/`. Both an absent
sender and an explicit false reply flag omit Reply; photo Back and Trash
cancellation restore the original Back/Trash footer. Both synthetic records
remain in the Board and no console warnings or errors were reported. Failed
storage recovery is covered by controller tests, not a simulated native failure.
