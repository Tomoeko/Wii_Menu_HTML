# Dictionary working memory and saved keyboard preferences

The verified USA 4.3 Latin path does not establish a durable learned-word
feature. Its observed mutable dictionary data is runtime working memory; the
identified native keyboard save record contains eight bytes of preferences.
The browser keeps first-party predictor state per editor and persists its
validated keyboard preferences separately. It does not serialize native
engine context or invent a learned-word format. The former optional native
emulator and its third-party runtime have been removed; the memory findings
below are bounded historical source analysis, not an active browser feature.

This finding concerns the supplied executable with SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43` and its
English, French and Spanish dictionary resources. It is not a claim about every
Zi8 product, another System Menu region, or untested input profiles.

## Original resource and memory ownership

`constructZiDIC` at `0x81333318` obtains six archive members through
`loadZiDIC` (`0x813332AC`): `eZTSystemENAM.zsd`, `eZTSystemFRCA.zsd`,
`eZTSystemESSA.zsd` and their three `eZTNintendo*.znd` counterparts. The loader
uses the archive lookup/start-address functions. Keyboard manager creation at
`0x81354F94` fills the system-language table at `0x816389E8` and OEM-language
table at `0x81638A40` from those resource pointers; unavailable languages use
the first available resource. The table getters are `0x81356438` and
`0x81356444`.

`WithZi::openDictionary` (`0x81433ED0`) calls `EZTXInitialize` (`0x8145EFD8`),
which calls `Zi8InitializeDynamic` (`0x8147C7C4`). That initializer clears the
entire `0x1B44`-byte context, installs the system-language table pointer and
sets engine defaults. `WithZi::ChangeDictionaryLanguage` (`0x81433AD8`)
detaches the previous OEM table and attaches the selected static OEM resource.
`SearchOEMDictionary` (`0x81433A50`) reads a count and offset table, then copies
an existing UTF-16 word into the requested output. It has no append/save path.
`WithZi` destruction (`0x81433C14`) frees the context allocation.

The native context belongs to the retained manager's shared input buffers,
not to each appearance of the software keyboard. Manager creation
(`0x8143C254`) calls `0x8141BD18`, which allocates WithZi at buffer-owner
offset `+0x0C`. Memo scene entry (`0x8140B640`) and Letter scene entry
(`0x813C04E4`) explicitly call `openDictionary`. Keyboard dismissal instead
runs command 6 through `0x81420F30` and `clearCandidates` (`0x81433D8C`).
`WithZi::init` (`0x81433D00`) also clears candidates and wrapper context;
it does not perform the full engine initialization. A synthetic execution
probe in all three Latin languages found that candidate clearing terminates
the highlighted word at its first UTF-16 unit. The remaining stale bytes do
not establish learned-word retention. Native teardown follows
`0x814375BC` to shared-buffer destruction (`0x8141BB70`) and WithZi destruction;
none of those routines serializes the context.

The word-history operation `Zi8SetHighlightedWordW` (`0x81465260`) validates
a maximum of 63 UTF-16 units and stores the string at context offset `0x187A`.
Its companion `ZiprocessHighlightedW` (`0x81465490`) updates other fields
inside that context. Those fields are not a serialized dictionary. The
original initializer clears them. `WithZi::confirm` is a tail call to update,
and the verified Latin candidate command `0x15` calls `getPredicted`, inserts
the returned string, then clears candidates; it is not a save operation.

## The eight-byte native preference record

`Memo::Manager::setSaveData` (`0x8143DCA0`) constructs this record at manager
offsets `0x48..0x4F`. Its direct byte stores and bit insertions establish the
following layout. `reflectSaveData` (`0x8143DDDC`) accepts revision nibble one;
`reflectSaveDataRev1` (`0x8143DDFC`) applies its fields, while other revisions
use `reflectSaveDataDefault` (`0x8143DFB8`).

| Byte | Observed meaning |
| --- | --- |
| 0 | Revision one in the high nibble; bit zero selects QWERTY versus telephone. |
| 1 | Prediction/dictionary-language mode, with `0xFA` meaning retain the current/default mode during restore. |
| 2 | Prediction enabled flag. |
| 3 | Symbol-page index. |
| 4 | Telephone uppercase flag in bit 7; telephone input mode in bits 6..3; QWERTY alphabet selection in bit 2; inverted hardware Num Lock flag in bit 1; bit 0 cleared. |
| 5 | Two four-bit QWERTY input-mode values. |
| 6..7 | Written as zero. |

The meaning of these fields is supported by the called getters and restore
operations, including toolbar selection (`0x814101E0`), prediction state
(`0x81429D20`), telephone input mode (`0x81417D1C`), uppercase state
(`0x8141B9E8`), and hardware modifier access (`0x81447860`/`0x81447950`).
This audit does not assign new browser meanings to unsupported native mode
values. No string, word count, learned payload pointer or variable-length
record appears in these eight bytes.

`ipl::keyboard::Manager::doSave` (`0x81356214`) compares eight bytes and, when
changed and no earlier write is pending, copies the record through
`setMemoSetting` (`0x81357DF0`). The destination is savedata-manager offset
`0x330`, or file offset `0x310` because file data starts at manager offset
`0x20`. Keyboard-manager creation loads the same eight bytes; the memo getter
at `0x81356368` returns that record in the two PowerPC return registers.

Both acceptance (`0x81355D14`) and cancellation (`0x81355DC4`) reach this
same save routine for manager modes 1 and 2, used by Memo and Letter.
Close-state entry (`0x81440B48`) first calls `setSaveData` through manager
virtual slot `+0xEC`. The only identified direct caller of `setMemoSetting`
is `doSave`; its payload contains the eight preference bytes, with no
dictionary-context pointer or additional learned-data payload. This is
positive evidence for the traced preference save path, not proof that an
unexamined profile has no other storage path.

The enclosing file is `/title/00000001/00000002/data/iplsave.bin`, from the
original pointer at `0x81696210` and string at `0x81639148`. Its default header
routine (`0x81358558`) writes magic `RIPL`, size `0x4C0`, and version 3.
`flushAsync` (`0x81357E34`) hashes the first `0x4B0` bytes with MD5, appends
its 16-byte digest, and writes `0x4C0` bytes. The reader (`0x81358154`) checks
the magic, supported version, declared length against available file length,
and final MD5. These are properties of the whole System Menu preferences
file, not a separate learned dictionary. The native default keyboard routine
(`0x81358594`) produces `11 fa 00 00 90 10 00 00` from zeroed synthetic data.

## Browser preference storage

The browser stores a validated JSON object under the local-storage key
`wii-menu.keyboard-preferences`. Schema version 2 retains the existing
`predictionEnabled` boolean and `dictionaryLanguage` (`en`, `fr`, or `es`),
and adds these supported UI choices:

| Field | Values |
| --- | --- |
| `layoutMode` | `qwerty` or `phone` |
| `phoneMode` | Existing telephone tabs: `0` = `Abc`, `1` = `abc`, `2` = `ABC`, `3` = `123` |
| `symbolPage` | Zero-based page index, currently `0..9` |

Version 1 records migrate without losing their dictionary language or toggle.
New or invalid fields take safe UI defaults. The record deliberately describes
the browser's supported controls; it is not an encoding of the native save
bytes. In particular, it does not assign a Latin meaning to unimplemented
regional input modes, the separate native uppercase bit, or QWERTY mode
nibbles. The distinction matters because the native record represents more
keyboard variants than the browser currently implements.

An explicit control change writes its preference even if the user later quits
the editor. Opening Memo, Letter, Address Book or Settings obtains the current
record through its getter. A numeric field forces its effective layout to
telephone/numbers; a QWERTY-only field similarly constrains its own layout.
Neither override changes the saved general preference. A field that disables
prediction preserves the saved toggle when another supported preference is
changed. Hardware Shift and Caps Lock remain independent transient input
state; they do not rewrite the selected telephone tab.

Each browser editor owns predictor state for its lifetime. Normal dismissal and
forced Settings or Board removal release that state once.
Forced removal is silent: it does not accept/cancel a form, play a dismissal cue,
or persist another edit. Memo, Address and Letter owners dispose their child
keyboards before dropping them, and late prediction responses cannot update the
removed editor or a newly opened one. This isolation is a browser adaptation:
native input buffers retain their context until manager destruction, and
scene entry performs a full dictionary reset. Behavioral equivalence across
keyboard dismissal and reopening within the same Memo or Letter scene remains
an acceptance check.
Deferred-response regressions exercise these ownership boundaries. A removed
Letter owner also ignores late local-save completion/error callbacks; a write
already dispatched to local storage can still complete there.

The source restore at `0x8143DDFC` reapplies toolbar layout, telephone mode,
uppercase state and symbol page. The symbol window open routine
(`0x814314D8`, specifically `0x814315A0..0x814315CC`) reads its existing page
byte at `+0x17` for the key tops and page-number setup. The browser therefore
retains the selected More page both within one editor and across reopening.
Tests cover version migration, invalid data, actual adapter reopen lifecycles,
the restored labels and inserted telephone character, and forced-profile
isolation. These establish the supported persistence behavior, not complete
equivalence for the unsupported native keyboard modes.

### Address field profiles and reload isolation

The USA 4.3 Address input callbacks construct IPL keyboard requests separately
from the saved general preferences. `0x8138CECC` requests Wii Number type `12`
with a 16-unit maximum and two rows, or e-mail type `7` with a 99-unit maximum
and five rows. Nickname callbacks `0x8138CD94` and `0x8138CFBC` request type `11`
with a ten-unit maximum and one row. Their region-dependent type-13 branches
do not apply to the supplied USA profile; this implementation does not infer
other regional mappings.

The dispatch table at `0x81638DB8` and manager vtable at `0x816680A8` resolve
these requests to the following configurations:

| Address field | Manager configuration | Supported browser behavior |
| --- | --- | --- |
| Wii Number, type 12 | `0x8143CEF0`, numeric base `0x8143CDA4` | Large textbox, numeric telephone keys, no layout switching, prediction or More |
| E-mail, type 7 | `0x8143D510` | Normal textbox, QWERTY only, no prediction or More |
| Nickname, type 11 | `0x8143D8D0` | Large textbox, selectable layout and More, no prediction |

Address nickname differs from Console Nickname type `6` (`0x8143D3B0`): the
type-11 setup enables the phone `+0x118` and ASCII `+0x134` More controls. Its
explicit layout or symbol-page changes update the general record while retaining
the disabled field's saved prediction toggle and language. Opening either forced
Address profile cannot write its effective layout or numeric telephone tab into
that record. Address now receives the same font-metric callback as Settings, so
the native row limit also governs accepted text, clipping and field scrolling.
Address and its Create owner forward pointer caret selection and held field-arrow
input to the active keyboard. Their `scene-key-text-up/down` host IDs retain
focus on release, just like Settings' prefixed field arrows. Both original
aspect ratios are tested using rendered pane transforms after manual scrolling;
the inserted character verifies the selected index. The same resource-backed
regression checks the 60-update first repeat and stops it on release, blur,
normal closure or disposal. Closed forms cannot accept a stale text hit.

The resource-backed reload regression destroys the Memo owner after selecting
dictionary, telephone case and symbol page, retains only the serialized JSON,
and constructs new Settings, Address, Memo and Letter owners. It verifies the
forced modes, suppressed controls, input bounds, unchanged saved bytes and
restored original key labels and page number. A separate original-font test
exercises the e-mail field's five-row limit and scroll clip. These tests model
the application's JSON getter/callback boundary; a live browser reload is still
required for acceptance of the actual local-storage and navigation wiring.

The follow-up trace resolves both remaining flags. Type 12 sets textbox byte
`+0x2CE` through `0x81425FD0`. Textbox calc at `0x814261A0` uses that byte solely
as the selected separator pane's visibility: the Latin table at `0x81615278`
names `N_separateBarAll`. Type 12 now renders its three original vertical bars
from `fs_VK_textBox_b`; it does not insert spaces or change raw text/caret units.
The original geometry/material regression covers both aspects and checks that
types 3, 6, 10 and 11 continue to hide these bars.

The type-7 ASCII `+0x60` is a virtual-method slot, not an object-byte offset.
The ASCII constructor (`0x81438990`) installs vtable `0x8166021C`, whose slot
`+0x60` resolves to `0x814146F4`. That setter stores byte `+0x3C` and changes
non-Latin alphabet/mode selection. Its immediate branches distinguish language
indices 0, 8 and 9; normal Latin indices have no extra key-map change there.
The two direct reads, in mode normalization `0x814111F8` and reset `0x8141246C`,
likewise leave the Latin alphabet mode at zero independently of this flag.
Thus the supplied USA Latin e-mail profile needs no invented punctuation map
or extra character-validation rule for this call. Unsupported regional mode
semantics remain outside this implementation. Native/browser field captures
and the remaining native preference bits remain fidelity gaps.

## Earlier execution probe

The optional emulator probe was removed with its third-party dependency.

The probe used synthetic queries and synthetic save-manager memory. It never
loaded or changed a console save. A guest memory-write hook observed executed
stores during English/French/Spanish query, selection, reopen, and telephone
selection sequences. Host setup and session-restoration copies were excluded.
The retained run found no writes outside wrapper memory, wrapper globals,
engine context, output, stack and the explicitly allocated synthetic save
fixtures. In particular, the six dictionary resources were never written.
The highlighted word was inside context memory and was cleared by executing
the original initializer. Original getters/setters copied exactly eight
preference bytes; the original MD5 functions matched the host digest over the
synthetic `0x4B0`-byte prefix. These execution checks are no longer part of the
repository's test suite.

A reopened host session returning the same candidates is only evidence about
this bounded harness. It is not a substitute for rebooting the native menu.
The earlier report recorded that limitation and the exact executable hash.

### Same-scene context comparison

The separate lifetime probe compared two original-code memory snapshots:
retained RAM after the identified native Latin dismissal operation, and the
fresh context used when the browser creates another keyboard session. It does
not equate host session recreation with a native close/reopen sequence.

The optional lifetime probe was removed with the emulator.

Twelve synthetic histories covered typed corrections, candidate acceptance,
telephone input and mixed input in English, French and Spanish. Each history
ended with the original `clearCandidates` routine; every subsequent comparison
started from an independent snapshot. The probe compared full candidate order
and candidate acceptance across lower, title and uppercase text/telephone
queries. Its retained contexts contained different working bytes from a fresh
context, making it a comparison of distinct states rather than two resets of
the same state.

The September 21 run found no mismatch in 468 full candidate-list comparisons
and 468 subsequent candidate acceptances.
The retained contexts differed from fresh contexts by 464–560 bytes, and their
user-word attachment fields remained zero. These bounded results supply no
observable reason to change browser session ownership. Native UI close/reopen
within a single Memo or Letter scene, all possible input histories, other
profiles, NAND I/O and menu restart remain outside this probe. The same-scene
acceptance gate therefore stays open.

## Remaining discriminating checks

The engine includes user-word matchers even though the tested Latin wrappers
do not attach user-word buffers. `Zi8GetZHuwdPtr` (`0x81480C9C`) reads pointers
at context `+0x124/+0x128` and selector `+0x12C`;
`Zi8MatchUWDdata` (`0x814804C4`) reads pointers at `+0x130/+0x134` and selector
`+0x138`. Those attachment bytes stayed zero in all three Latin probes. Their
presence alone does not demonstrate that the System Menu saves learned words.

Before adding any durable learned-data behavior, a new investigation must
identify a reachable writer/attachment operation for those fields in the
relevant native profile, follow its caller to a storage owner, and establish
its size, format and validation rules. A native RAM/NAND trace across input,
confirmation, keyboard closure and menu restart would test whether an
unobserved storage path exists. Japanese/Chinese/Korean and other native
command modes remain outside this Latin harness. Until that evidence exists,
there is no supported learned-persistence format to implement.
