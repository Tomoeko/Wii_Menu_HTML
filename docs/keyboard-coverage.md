# Keyboard coverage inventory

This inventory separates verified USA 4.3 menu callers, shared native library
operations and browser adaptations. It is not a declaration of full keyboard
parity. The executable identity, resource hashes, captures and probe commands
are recorded in [keyboard source notes](keyboard-source-notes.md) and
[dictionary state](dictionary-state.md).

## Reachable field owners

IPL dispatch `0x81356050`, table `0x81638DB8`, and manager vtable `0x816680A8`
establish the request configurations. Menu caller evidence is required in
addition to a library entry before exposing a new field.

| Menu owner | Request / native configuration | Implemented browser route |
| --- | --- | --- |
| Memo | 1 / `0x8143CF48` | `BoardCreate` owns Memo text, composition, keyboard lifecycle, line scrolling and caret hit geometry. |
| Letter and local Reply | 2 / `0x8143D0EC` | `BoardLetter` owns the Letter text sheet and forwards keyboard, held-control and text-hit input; parents forward only to their active child. |
| Numeric Settings | 3 / `0x8143CDA4` | Forced numeric phone profile; effective layout does not overwrite the general preference. |
| Symbols-enabled Settings | 5 / `0x8143DA30` | Restricted profile with original More pages and field-specific limits. |
| Console Nickname | 6 / `0x8143D3B0` | Large text field, ten UTF-16 units, both layouts, no dictionary or More; original HTML marker remains a separate owner. |
| Restricted Settings / Address e-mail | 7 / `0x8143D510` | Forced QWERTY without dictionary/More; Address uses its source five-row/99-unit limit. |
| Dotted numeric Settings | 10 / `0x8143D890` | Numeric setup plus decimal point; row/length constraints belong to the original field. |
| Address nickname | 11 / `0x8143D8D0` | Large ten-unit field, both layouts and More, no prediction. |
| Address Wii Number | 12 / `0x8143CEF0` | Sixteen numeric units and original separator artwork; validation belongs to the registration controller. |

Type 13 (`0x8143DB88`) is reached by identified special-language branches; those
branches do not establish another USA Latin field. Types 0, 4 and 8 resolve to
`0x8143CCBC`, `0x8143D298` and `0x8143D6A4`, but an additional USA user-facing
caller has not been established. Type 9 (`0x8143D838`) is also the numeric base
called by type 10. These table slots alone are not missing browser scenes.

## Reachable operation coverage

The Base command table is `0x8165CA8C`. Command numbers here refer to that
owner, not similarly numbered local keytop events or IPL request types.

| Operation / verified source | Browser coverage and remaining boundary |
| --- | --- |
| Ordinary character input, Base command 0 (`0x8141CD5C`) | Shared text/field limits, source keytop animation, dictionary input and result cue. Native physical keyboard versus host `keydown` timing still needs device acceptance. |
| Delete, Base command 1 (`0x8141D2E0`); forward deletion, command 2 (`0x8141D55C`) | Backspace and host Delete update the active text/composition. Source keytop callbacks restrict held repetition to Backspace and QWERTY Space: first update 36, then every nine. |
| Commit and line feed, commands 6/7 (`0x81420F30`, `0x8141D5D4`) | Active composition and literal LF are separate; original LF decoration is editing-only. The verified 32-unit boundary commits the full selected string before the next composition. Async queue ownership is a documented browser adaptation. |
| ASCII callback (`0x81415994`) | Original key, modifier, selected-tab and popup resources, held deletion/Space, and single-action ordinary keys. Hardware modifier bits remain distinct from saved onscreen preferences. |
| Phone callback (`0x8141B55C`) | Original modes, numeric restrictions, forward/reverse multi-tap, departure/90-update completion, prediction digits and held Backspace. Fresh host secondary click maps the native B trigger; no held-B or Escape reinterpretation. |
| Prediction toggle and language | Original transition locks, separate English/French/Spanish engine sessions and retained general preferences. Other language engines/layouts are not validated by the USA Latin harness. |
| Candidate acceptance/preview, commands `0x15`/`0x16` (`0x8141E010`, `0x81424350`) | Full candidate insertion, selected preview, material ownership, clipping and disabled-control occlusion. Selection does not add a separator. |
| Candidate arrows (`0x8142D824`) | Both directions, original scalar's update-16 input release, native hover-counter predicate, held owner and lifecycle. Original-code probe and browser trajectories exist; full native capture alignment remains open. |
| Text scroll, command `0x18` via `0x814274B0` | Memo, Letter and field arrows share the native 60/20 repeat and source line movement. Scroll transforms feed pointer hit testing. |
| Text point input, commands `0x0E`/`0x0F`/`0x10` via `0x814274B0` | Fresh pointer input commits an active selected completion before a later click places the literal caret. Open and closed-draft editor paths use the visible text coordinates. Continuing held-point and release callbacks require an activation flag not yet established for an ordinary editor session; see below. |
| WithZi input/backspace/get/clear (`0x81433F40`, `0x81434088`, `0x81434140`, `0x81433D8C`) | Original instructions execute in the local worker, with ordered isolated editor sessions. The native manager's same-scene RAM lifetime still needs full-scene acceptance; the bounded retained/fresh probe found no candidate difference. |
| Eight-byte native preferences | Readable version-2 JSON preserves supported layout, phone mode, symbol page, prediction toggle and language. Forced fields do not save their effective overrides. Unknown bit modes are not assigned invented meanings. |

## Concrete remaining work

Held text-point input remains a conditional native path, not yet a proven
browser omission. For the active original text pane, `0x814274B0` sends command
`0x0E` on fresh A, `0x10` during continuing held A, and `0x0F` on A release.
The command table maps these to `0x8141DD04`, `0x8141DEE4` and `0x8141DE44`.
Both continuation and release require active buffer byte `+0x20`. The original
reset clears this flag; a bounded execution probe finds that fresh press changes
the caret but leaves the flag clear, so following held/release commands do
nothing. Explicitly invoking the buffer's selection-start method makes those
same commands move the caret, but no ordinary USA scene caller enabling that
state has been established. See the text-point probe in
[keyboard source notes](keyboard-source-notes.md#conditional-native-text-point-continuation).
The browser keeps pointer-down caret placement. Full owner activation, release
and outside-pane scroll evidence must precede held routing; these conditional
calls alone do not establish selection-range highlighting or clipboard behavior.

The telephone/numeric Backspace's right edge remains outside the browser
viewport with the authored hierarchy. Source resource identity and transforms
were checked, but a missing native projection/owner transform has not been
established. Keep its geometry unchanged until the corresponding native view
can distinguish the cause.

Remaining evidence is bounded rather than an open-ended list of table entries:

- Capture held text input, candidate and keytop lifecycles in a native scene,
  including the scene's text-scroll and field-lock conditions.
- Compare same-scene dictionary close/reopen in the full menu; the existing
  RAM probe and preserved preferences do not establish every scene lifetime.
- Validate native input sequences and region-specific callers before extending
  to other executable versions, Japanese, Chinese or Korean behavior. Existing
  library resources and engine entry points alone do not establish active paths.
- Establish a reachable writer and loader before adding durable learned data.
  The traced Latin teardown saves eight preference bytes; the user-word buffer
  attachments remain unproven for this menu path.
- Keep host keyboard repeat, secondary mouse mapping, async service latency,
  clipboard/paste and IME events distinct from original controller semantics.
  Unsupported host operations should not be presented as recovered native ones.

Source/resource tests and retained browser runs establish only their stated
scopes. They do not close aligned native visual/audio or physical-device
acceptance in the roadmap.
