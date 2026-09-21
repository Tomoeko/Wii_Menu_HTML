# Local Message Board records

Posted Memos are stored in `.local/message-board.json` by the local server. This
readable JSON file contains text, creation time, read time and the card position.
The browser keeps its unfinished draft separately. Nothing is sent to Nintendo,
WiiConnect24 or another recipient.

```json
{
  "version": 1,
  "memos": [
    {
      "id": "example-memo",
      "text": "A local Memo",
      "createdAt": "2026-09-17T16:00:00.000Z",
      "readAt": null,
      "position": { "x": -115, "y": 53 }
    }
  ]
}
```

The position uses the original Board record coordinates, with positive Y up.
IDs must be unique. Dates must be valid timestamps. Text is limited to 10,000
UTF-16 units, and a file may contain up to 2,000 records. The endpoint validates
all records before replacing the file. Writes are serialized and committed by
rename, so an invalid request preserves the existing data.

```sh
node tools/message-board.mjs show
node tools/message-board.mjs export /path/to/memos.json
node tools/message-board.mjs import /path/to/memos.json
```

This import replaces the Memo collection after validation. Existing incoming
Letters omitted from the imported file are preserved; their immutable content
cannot be rewritten through this command. Use the
[incoming Letter importer](incoming-letters.md) to add or restore validated
Letters and their local photos. Reload the menu after an import or direct file
edit. Export first to retain a copy of the current records.
`GET /api/message-board` reads the same file. A missing file starts an empty Board. A malformed file reports
an error instead of silently overwriting its contents.

Browser saves use `PUT /api/message-board` with `{version: 1, base, memos}`;
`base` is the array from the last accepted server response. Under the shared
Board lock, the server compares base, current records and desired records.
Independent field edits merge, including read time and position. Position is
one field. Records added by another session survive a stale save. Omission does
not delete either Memos or incoming Letters. An unchanged stale copy of an
erased record remains absent; an attempted edit to it or conflicting edits to
the same field return HTTP 409 without changing the file. New identity collisions
also conflict. Incoming content remains immutable. CLI import still deliberately
replaces the Memo collection and can restore an erased Memo; no file-version
migration, revision counter or persistent tombstone is introduced.

The browser calls `prepareMessageBoardSave(records)` when the UI changes and
queues its returned function. Proposed UI state is separate from the accepted
server baseline, so older queued snapshots do not overwrite remote changes
learned from an earlier response. A failed operation retains its unsaved intent
for a later retry or edit. An unavailable initial read blocks saves rather than
assuming an empty baseline. Successful saves return the merged record array for
the browser cache; unrelated records changed in another session become visible
on reload. Pending, uncommitted changes remain in the current session, not a
durable offline queue. A conflict requires reload and deliberate reconciliation.

Memo Trash uses the original two-button dialog, `ExitLetter`, 17-update return
position and `WIPL_SE_BOARD_DUMP`. The controller waits for both that exit and
the explicit host commit before removing the record. `POST
/api/message-board/erase-memo` accepts `{version: 1, id}` under the same lock,
rejects IDs belonging to incoming Letters and safely acknowledges an already
absent ID. `onEraseMemo(id)` supplies its promise; `onBoardError(error)` reports
failure while the reader, record and scroll position are restored for retry.
This failure recovery is a local safety adaptation. Synthetic tests cover both
completion orders, failure/retry, concurrent saves, stale snapshots and kind
guards. No new native visual-equivalence claim follows from these tests.

An isolated browser run also exercised a failed Memo erase under a test-owned
Board lock, followed by a successful retry after that lock was removed. The
121-pose failure sequence `1789985023122-ad5b42f2` restored the reader and its
notice with both records still on disk; the dismissal capture
`1789985066230-4126d744` retained Back/Trash. The 121-pose retry
`1789985088945-8a278ec0` returned to the Board with only the original Memo.
The resulting Board file exactly matched the pre-test backup, and the outbox
was unchanged. Source and checks are retained in
`artifacts/browser-qa/memo-erase-ui/audit.json`, using the
`combined-memo-merge-candidates` snapshot. This validates the local failure and
retry flow, not native timing or image equivalence.

## Resource use and verification status

The supplied WAD and its verified USA 4.3 executable are the reference. Earlier
decompilation filenames and function labels helped locate behavior, but are not
independent proof of the original implementation. The table distinguishes
retained executable/resource evidence from adapter rules still awaiting native
verification. [Input identity](reference-map.md) bounds the addresses below.

| Behavior                  | Retained evidence and limits                                                                                                                                               | Adapter                                                                                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial placement         | `RBRGetPosRect` 0x81332BE0 reads −230, 230, 180, −80 from 0x81694400. The shared NWC24 receive path 0x81343340–0x81343380 samples Y, then X, with single-precision arithmetic. | Samples the same bounds and operation order once, then persists the result. The local random source is independent of the console PRNG state. |
| Memo record creation path | `TextWriter::onSend` 0x8140C69C and `sendMessageByNWC24` 0x8140C92C target the console's own ID. This does not independently establish the downstream placement algorithm. | Local file transport replaces the native delivery task.                                                                                                                                                                  |
| Card arrival              | Original `LetterS_a_PasteLetter` resource contains 11 intervals; its complete native scheduling remains unpaired.                                                          | A new card begins its pin animation when the composer has exited, with `WIPL_SE_MSG_DISP`; unrelated cards retain their clocks.                                                                                          |
| Grab and release          | Earlier controller interpretation has no retained executable-address analysis or replacement native sequence.                                                              | Pointer motion is not clamped during a grab. Release clamps to the configured record bounds; cancellation restores the prior persisted position. Widescreen horizontal input receives the implemented aspect correction. |
| Drag sound                | `holdSEwithPosDis` 0x8136B8A0, gain/pan instructions 0x8136B948–0x8136B98C                                                                                                 | `WIPL_SE_BOARD_DRAG` uses gain `min(1, 2 * speed / 304)` and pan `x / 304`; stationary motion has zero gain.                                                                                                             |
| Reader scroll             | USA 4.3 `Scroller::calc` 0x81363CF8 initializes the 20-update curve. Full visual alignment remains open.                                                                   | Reader scrolling retains a separate position and animation clock.                                                                                                                                                        |
| Crowded-date paging       | USA 4.3 `ObjList` constructor 0x81393C10 allocates ten card objects. `read_task` 0x81391B64 searches the selected day newest first. Older/newer handlers 0x8139157C/0x81391638 retain the date. | Views contain at most ten records. Left reveals older records; right returns to newer records before either arrow changes the date. Equal timestamps retain file order, an explicit local adapter rule. |
| Calendar message icon     | Original `dateMessage` group and `Info_a` material alpha are resource evidence; native record-to-icon dispatch remains unverified.                                         | Dates containing records show the original icon; the Calendar refreshes after record changes.                                                                                                                            |
| Footer count              | USA 4.3 count task `0x813919C4` searches the current calendar day; callback `0x81391904` accepts `txt`, `odh`, `dat` and `log` through `0x8133F8EC`. `Board::calc` clamps to 0–99 at `0x8138F408–0x8138F42C` and writes `T_BbsMark1`. No read-status filter occurs in this count path. | Counts supported local Memos and Letters on the browser's actual current date, capped at 99, independently of `readAt` and the date selected on the Board. Raw CDB type filtering and NAND/SD records are not implemented. |
| New-arrival signal        | Original `G_BbsSignal_new` and `WIPL_SE_NEW_ARRIVAL` assets; notification scheduling remains unverified.                                                                   | The host owns notification acknowledgement and the signal clock.                                                                                                                                                         |
| Board return layering     | Earlier draw-order interpretation has no retained executable-address analysis or replacement native populated-board sequence.                                              | Returned Board cards stay at their stored coordinates beneath the Wii Menu grid; overlapping pixels are covered while the edge portion remains visible after the Board scene closes.                                                                                              |

The count task constructs inclusive `00:00:00` and `23:59:59` endpoints at
`0x81391A18–0x81391A58`. The final CDB predicate compares each record's unsigned
integer-second timestamp against both endpoints at `0x81487B60–0x81487B78`;
the earlier year/month/day checks prune directory ranges rather than giving a
record a multi-day duration. The search uses NAND or NAND plus SD according to
the CDB storage flag at `0x81391A78–0x81391AA8`. Its count callback accepts the
four type strings stored at `0x81696040/48/50/58`, using an eight-byte bounded
comparison. These instructions are retained in the private
`artifacts/footer-count-audit/native-count-contract.json` evidence.

Local `createdAt` values are ISO timestamps with millisecond precision, grouped
by browser-local calendar date. This includes the entire final second of the
day and preserves the verified date/count rule for the admitted local records.
It does not establish equivalence for console clock offsets, native search-task
scheduling, storage duplicates or additional CDB record types. Midnight rollover
timing and populated footer visuals still need an aligned native/browser pair.

The browser does not reproduce the console PRNG's exact sequence. The record's
`readAt` is local state, set when its reader opens. USA 4.3 instructions at
0x81394A58–0x81394B0C compare the record time against the current time, then
multiply the timer frequency by `0x5460` (21,600 seconds). Past records younger
than six hours select the original New pin animation; older records select its
default animation. Equal or future timestamps leave the base resource pose.
The adapter samples that choice once per card appearance, as native creation
does, so a card does not change pin type partway through its display.

## Trash confirmation and deletion

Trash uses the original common button, `my_DialogWindow_b`, localized message 64
("Erase this?"), and buttons 37/46 (Quit/OK). It does not use an HTML alert.
The implemented sequence is button selection for 20 updates, footer retraction for
13, dialog entrance for 26, selection for 21 and dialog exit for 26. Quit then
restores the common footer over 13 updates. OK plays `WIPL_SE_BOARD_DUMP`, runs
the original 17-update reader exit, removes the selected local record and saves
the remaining collection. Resource clips establish authored animation intervals;
their sequencing, deletion boundary and native dialog-argument mapping still
need a retained executable-address audit or fresh native comparison. Earlier
decompilation controller labels are not used as authoritative evidence here.

Controller tests cover animation boundaries, Quit preserving data, OK deleting
only after the exit, drag cancellation, release bounds, immutability of source
layouts, Calendar icon material alpha, card arrival deferral, and JSON round trips.
The previous keyboard/Memo/Trash captures were deleted. The
[current capture ledger](fidelity-evidence.md) records the retained September 21
channel, HOME, GameCube and Board-return observations. Those do not replace a
populated Memo/Trash comparison or validate the other behavior in this table.

## Crowded dates

The date arrows first traverse groups of ten records. The original
`LetterS_a_NextPage` clip lasts 15 updates. The BoardObject calculation at
0x81394134 linearly moves each departing card toward X ±304, Y 53 in the original
record coordinate system while applying that clip; widescreen then scales X by
the projection width divided by 608. The older and newer handlers pan
`WIPL_SE_MSG_HOUSE` toward opposite sides. Original `G_TabaL` and `G_TabaR`
envelope indicators show which direction has further records on the same date.

Paging locks card and footer actions during departure, then presents the next
group using the original arrival clip. Changing the date resets to its newest
group. Erasing the final record on an older page clamps to the preceding valid
page. Posting a Memo returns to the newest group. Browsing does not write or
reorder the stored collection. Controller regressions cover 23 records, both
directions, date limits, deletion, posting and preservation of every record.
The incoming-group scheduling and populated native/browser frame alignment
remain unverified; the resource and executable evidence does not close that gate.

## Integration

`createMenuScenes({memos, onMemos, onSound, ...})` receives loaded records and emits
the complete new collection on post, position change, opening an unread Memo or
erasure. The host loads/saves asynchronously. `getMemos()`, `setMemos(records)`
and `messageSummary(date)` provide explicit state access. `onSound(id, options)`
uses original WIPL identifiers; drag options carry `loop`, `gain`, `pan` and
`speed`. The host owns actual effect playback and notification acknowledgement.

`pointerDown(id, point)`, `pointerMove(point)`, `pointerUp(point)` and
`cancelPointer()` operate in centered logical screen coordinates, X right/Y up.
While a Memo is grabbed, other Board actions are suppressed. Keyboard keyup
notifications do not retrigger reader scrolling.

Reader arrow hover and press use the same original-resource helper as the text
editors, with different input rules. USA 4.3 reader event handler 0x8139B698 sends
pointer entry/departure to 0x8139AC70/0x8139ADF4 and tests `downTrg(0x100800)`
before 0x8139AF08 starts scrolling. The Scroller idle gate is 0x813976D4.
One pointer press moves 300 record units over 21 updates, including its initial
zero-position update. Holding it does not repeat. The editor's independently
verified 60/20 repeat cadence is therefore not applied to the reader. Its hover
bubble survives a click and release, then clears on departure, bounds, blur or
reopening; clicks during a movement are consumed without starting another one.
Physical held-pointer and complete native visual alignment remain open checks.

The posted reader intentionally differs from the line-at-a-time editor. Its
source endpoints at `0x8169628C`–`0x81696298` are zero to minus/plus 300, and its
duration constant at `0x81694628` is 20. Each sampled position is clamped after
interpolation (`0x81363F44`–`0x81363F68`). A short overflowing Memo can therefore
reach the top or bottom with one press: five original text rows produce a
122-unit range, smaller than the native step. Regression tests check intermediate
positions so this is a smooth page movement, rather than an immediate jump.

Reader arrow entry now emits the original `WIPL_SE_BT_TARGETTING` cue from
`0x8139AC70` / `0x8139ADC0`. Scroller's tail at `0x81363F6C` compares the absolute
clamped movement with one unit and calls `holdSE` (`0x8136B7A0`) for
`WIPL_SE_MESSAGE_SCROLL` only above that threshold. The browser owns one movement
loop, releases it when movement falls below the threshold or the reader is
closed/reset, and exposes `suspendAudio()` for a host that freezes scene updates.
It samples the last logical update when browser time advances in a batch, so a
delayed render cannot start a stale cue after motion has ended. Native HoldSound
at `0x8150BCA4` refreshes an auto-stop counter to one through `0x814FCB48`;
BasicSound Update (`0x814FCD28`–`0x814FCD7C`) decrements a positive counter, then
calls Stop(0) on an update that finds zero. Stop(0) takes the immediate shutdown
branch at `0x814FC6E8`. The order of those audio updates relative to scene calc,
lower sequence release and sample-aligned audio acceptance remain open; the
implemented threshold and ownership do not establish exact AX playback.

Full synchronized image/audio parity remains unverified. The host applies the
verified speed-dependent drag pitch ratio; the original AX envelope, modulation,
pan law and reverb remain approximate. The
native ten-record paging behavior is implemented with the limits above.
Native NAND/SD delivery errors,
protected messages, attachments and the complete letter/address flow remain
separate unimplemented service or presentation branches.

## Erase-dialog allocation work

Memo status queries read the dialog's shared lock predicate without posing its
artwork. Each presentation reuses one dialog layout for drawing and controls;
the state and returned controls remain fresh and preserve their existing shapes.
Regressions cover entry, idle, selection, exit, cancellation and defensive output
isolation. These changes do not introduce a persistent mutable-pose cache.

A deterministic local Node workload with original layouts reduced one status
query from 0.23171 to 0.000454 ms. A modeled visible-pointer Board frame reduced
dialog poses from eight to one, structured clones from 26 to 12, and median CPU
time from 3.46093 to 1.91183 ms. Fixed fixture position/read state produced equal
serialized output hashes before and after. These are controller measurements,
not browser/GPU timings or a new native-animation acceptance claim.
