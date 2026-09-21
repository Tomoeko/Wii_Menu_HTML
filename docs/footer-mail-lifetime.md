# New-arrival cue ownership on Board entry

The browser now stops the grid's recurring new-arrival request when the
departing ChannelSelect child retires. Entering an incoming Letter or photo
therefore cannot leave a stale grid notification timer running. This lifetime
change is independent of rendering the hidden footer and does not stop an
already-playing cue or change its sample math.

The original USA 4.3 executable has SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
Read-only Binary Ninja inspection verified these instructions:

- `Board::stt_wait_child_dst`, `0x813906A4`, checks that ChannelSelect,
  Calendar, MailAddressSelect and a reserved child are absent. Its normal-Board
  branch calls `Button::stopNewMailAnm` at `0x813907A0`, before entering normal
  state at `0x813907B0`.
- `stopNewMailAnm`, `0x8139D188`, clears the active byte at offset `0x104`
  with the store at `0x8139D1E4`. It does not stop a sound handle.
- `Button::calc` requires that active byte and a clear suppression byte before
  testing the timer at `0x8139C454–478`. Only then does it request the next
  animation/cue at `0x8139C480`. `startNewMailAnm_` requests the original
  `WIPL_SE_NEW_ARRIVAL` symbol at `0x8139D160` and arms 3,000 milliseconds at
  `0x8139D168–16C`.
- ChannelSelect starts its departing grid layout at frame 70 and ends at 90:
  `0x813ADA40–54`, using original floats at `0x81694974/978`.
  Its fadeout checks completion of that layout at `0x813AB054–064`, separately
  from the footer's forty-frame scene animation. Native module/page readiness
  can also delay destruction; this audit does not equate every presented image
  with one scene update.

`menu-scenes.js` emits `onBoardReady` once at the existing twenty-frame grid
retirement boundary while its footer transition continues. It splits coarse
advances at that boundary and discards the pending notification when entry is
replaced by another scene. `main.js` calls the explicit `footer.stopNewMail()`
method there and advances the scene before advancing the footer timer. The
existing `boardVisited` guard prevents a return to the grid from rearming the
acknowledged notification. This maps native ownership onto the browser's
existing scene model; exact native destruction scheduling remains a capture
comparison task.

The regression intentionally places a pending repeat at the same update as
the handoff: unread grid age 160, nineteen Board-entry updates, then one more.
The timer cannot issue that repeat. It remains silent while an actual incoming
Letter and its photo viewer are open, and after returning through the Board
to the grid, without calling the grid footer's pose method in those readers.
Other checks cover fractional/coarse advancement, one-time notification,
aborted entry and reopening. The focused footer/scene suite passes 28 tests.

This correction does not infer silence from visual hiding in other scenes,
change network arrival scheduling or replace the existing simulation-frame
adaptation of the native wall-clock timer. Ignored evidence is
`artifacts/audio-residual-audit/native-footer-mail-lifetime-proof.json` and
`footer-mail-ownership-tests.txt`. Browser validation is recorded separately
by the active incoming-mail fixture.
