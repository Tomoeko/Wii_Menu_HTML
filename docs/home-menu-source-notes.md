# HOME menu behavior and source evidence

The controller uses the supplied USA 4.3 executable and original
`homeBtn1/th_HomeBtn_d` layout, animation, texture and font resources. The input
WAD SHA-256 is
`bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`;
the verified executable SHA-256 is
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
Controller tests establish the implemented behavior below. Native frame and audio
alignment remain acceptance work. The full post-confirmation loading sequence is
documented separately in [Returning to a fresh Wii Menu](menu-restart.md).

## Original binding and transition ownership

Animation/group mappings come from executable tables `0x8160F3D8`,
`0x816450C8` and `0x8164525C`. Each group binds its listed panes without
recursively adopting independently animated children. Animation names below
omit the `th_HomeBtn_d_` prefix. The original frame controller at `0x81377C50`
stops one-shot playback at `frameMax - 1`; repeating mode wraps at `frameMax`.
Resource frame counts and elapsed state-update counts are therefore distinct.

| Flow                      | Original resources and groups                                                                                  | Implemented sequence                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open HOME                 | `hmMenu_strt`, matching group                                                                                  | 21-update entrance; `HOMESE_HOME_BUTTON` after entrance completion.                                                                                                                  |
| Close HOME                | `hmMenu_bar_psh`, then `hmMenu_fnsh`                                                                           | Header press followed by retraction and cleanup; 39 updates before restoring the previous scene.                                                                                     |
| Open Wii Remote Settings  | `optn_bar_psh`, `cntrl_up`, `cntrl_wndw_opn`                                                                   | Press/lift start together. Window and its sound start after the 16-frame lift; the 41-frame bar animation owns input readiness.                                                      |
| Close Wii Remote Settings | `hmMenu_bar_psh`, `close_bar_psh`, `cntrl_dwn`                                                                 | Start together; 40-frame close-bar ownership preserves the window shrink and remote descent.                                                                                         |
| Select Wii Menu           | `cntBtn_psh` on `btnL_00_psh`, then `cmn_msg_in`                                                               | Press reaches frame 16, then the dialog reaches frame 24; Yes/No stay locked until arrival completes.                                                                                |
| Answer No                 | `cmn_msg_btn_psh` on `msgBtn_01_psh`, then `cmn_msg_rtrn`                                                      | 20 updates of answer feedback, then 19 updates returning the dialog upward. HOME stays open.                                                                                         |
| Answer Yes                | `cmn_msg_btn_psh` on `msgBtn_00_psh`, then black fader                                                         | 20 updates of answer feedback, then 30 updates to black before returning to the first menu page.                                                                                     |
| Volume step               | `optn_btn_psh` on `optnBtn_00_psh` or `optnBtn_01_psh`; `sound_ylw`/`sound_gry` on `vol_00`–`vol_09`           | Independent ten-step remote volume, original button flash and `sound_on_00` glow. The glow resource is 16 frames.                                                                    |
| Rumble On                 | `vb_btn_wht_psh` or `vb_btn_ylw_ylw` on `optnBtn_10_cntrl`                                                     | Original 24-frame horizontal `cntrl_00` shake, including pressing an already selected On button.                                                                                     |
| Rumble Off                | `vb_btn_wht_psh` on `optnBtn_11_psh`, `vb_btn_ylw_psh` on `optnBtn_10_psh`                                     | Original selected/unselected button color transitions; no physical controller vibration.                                                                                             |
| Reconnect                 | `optn_btn_psh` on `optnBtn_20_psh`, `link_msg_in`, `12btn_on`, `link_msg_out`; `btry_*` on `plyr_00`–`plyr_03` | Press, disconnect/prompt animation, repeating 50-frame 1/2-button cue, explicit local connection, then prompt return. The 80-frame battery blinks continue independently for connected players. |

Trigger handling is at `0x81375B78`; HOME state advancement is at `0x81372E9C`.
The opening cue is requested at `0x813731A8`. Remote-settings opening requests
Select immediately at `0x81375E70`, then Open Controller at `0x81373640`.
Return-dialog paths are at `0x81375C24`, `0x81373660` and `0x813736DC`.
The black fader is initialized to 30 at `0x81372900`; its draw path at
`0x81376E48`–`0x81376E50` computes integer `floor(counter * 255 / 30)`.
The browser preserves that alpha quantization.

Header, channel-return, remote-settings and dialog hover use their original
`*_in`/`*_out` groups. Native focus sound dispatch at `0x81376B24` requires
more than two updates since the prior dispatch. The browser owns these cues
inside HOME and suppresses an additional generic button click.

## Original sound identifiers

`HomeButton::play_sound` at `0x81377080` calls the IPL callback at `0x81347AD0`.
For event 5, that callback calls `System::startSEIndex` at `0x8136B578` and
returns one, replacing the library's own playback. Indices 0–21 are the first
22 sounds in the supplied `IplSound.brsar`:

| Index   | Symbol suffix after `HOMESE_`                         | Use                                                                     |
| ------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| 0       | `HOME_BUTTON`                                         | Entrance complete.                                                      |
| 1       | `RETURN_APP`                                          | Close HOME.                                                             |
| 2       | `GOTO_MENU`                                           | Yes to returning to Wii Menu.                                           |
| 3       | `RESET_APP`                                           | Original software-reset answer; not exposed by this menu configuration. |
| 4       | `FOCUS`                                               | Native HOME hover.                                                      |
| 5       | `SELECT`                                              | Wii Menu, remote-settings opening and Reconnect press.                  |
| 6       | `CANCEL`                                              | No in the return confirmation.                                          |
| 7       | `OPEN_CONTROLLER`                                     | Remote-settings window opening.                                         |
| 8       | `CLOSE_CONTROLLER`                                    | Remote-settings closing.                                                |
| 9 / 10  | `VOLUME_PLUS` / `VOLUME_MINUS`                        | Normal volume steps.                                                    |
| 11 / 12 | `VOLUME_PLUS_LIMIT` / `VOLUME_MINUS_LIMIT`            | Step that reaches maximum/minimum.                                      |
| 13      | `NOTHING_DONE`                                        | Already at the volume limit or selecting the current rumble state.      |
| 14 / 15 | `VIBE_ON` / `VIBE_OFF`                                | Changed rumble state.                                                   |
| 16      | `START_CONNECT_WINDOW`                                | Reconnect press, together with Select.                                  |
| 17–20   | `CONNECTED`, `CONNECTED2`, `CONNECTED3`, `CONNECTED4` | Original connection cue for each configured player.                    |
| 21      | `END_CONNECT_WINDOW`                                  | Reconnect prompt dismissal.                                             |

The exporter prepares all 22 symbols. Sequence decoding retains original notes,
samples and timing; [audio limitations](audio-cues.md) still apply to the mix.

## Captions and remote speaker

`homebutton/home.csv` is a UTF-16 tab-separated table with four quoted rows and
ten locale columns. Preparation exports its reconnect, disconnecting, return and
reset captions to `manifest.homeMessages`. Yes/No labels use original picture
panes. Template text is never presented as the dialog caption.

The original layout names `RevoIpl_UtrilloProGrecoStd_M_32_I4.brfnt` for
`T_Dialog`. Its serif appearance is confirmed by fresh native frame
[42989](../artifacts/captures/address-settings-16x9/Frames/framedump_42989.png)
and repeated at
[46702](../artifacts/captures/address-settings-16x9/Frames/framedump_46702.png).
Yes/No remain sans-serif picture labels. The native
[recording metadata](../artifacts/captures/address-settings-16x9/capture-session.json)
identifies the supplied WAD, USA NTSC 16:9 mode and emulator executable.
These still frames confirm font style, not transition timing or pixel equality;
they do not justify overriding the original caption font.

`homebutton/SpeakerSe.arc` supplies `volume.bwav` and `connect1.bwav` through
`connect4.bwav`. `RemoteSpk::UpdateSpeaker`, `0x81378F98`, reads signed 16-bit
big-endian PCM in 40-sample blocks and encodes 20 bytes of ADPCM for a physical
remote. `Start`, `0x8137928C`, configures an approximately 6.666667ms alarm:
`(TimeBase / 125000) * 6666667 / 8000` ticks. This establishes 6000 samples/second.

The exporter preserves these five original PCM streams as mono 6000Hz WAVs,
identified by `HOME_SPEAKER_VOLUME` and `HOME_SPEAKER_CONNECT1`–`4`. Browser
playback does not emulate the final ADPCM encoding, radio delivery or the remote
speaker's acoustics. Connection playback follows the original 400ms alarm
request at `0x813745B8`; controller volume playback is requested separately from
the TV cue at `0x81375F30`.

## Local configuration and remaining limits

`wiiRemote.volume` defaults to `0.7`; it scales remote-speaker samples and does
not change `audio.volume`, the browser's master control. `wiiRemote.rumble`
defaults to `true` and controls the original visual selection/shake.
`wiiRemote.reconnectDelayMs` defaults to `3000` and accepts 0–60000. It is the
explicit automatic fixture wait after synchronization starts, not a measured
native hardware delay. The nested `wiiRemote.reconnect` object supports:

| Field | Fixture behavior |
| --- | --- |
| `mode` | `automatic` connects after the configured delay; `manual` waits for keyboard 1+2; `timeout` supplies no automatic connections and waits for the original counter limit. |
| `players` | Unique player slots 1–4 in callback order; default `[1]`. A manual 1+2 chord connects the next slot. Release a key before the next chord; repeated keydown events cannot connect another slot. |
| `intervalMs` | Automatic delay between player callbacks, 0–60000; default 400. |
| `startFailures` / `stopFailures` | Number of rejected synchronization start/stop attempts before success, 0–600. Each retry waits 100 ms. Defaults are zero. |

For example, `{"mode":"automatic","players":[1,2,3,4],"intervalMs":400,
"startFailures":2,"stopFailures":1}` exercises four connections and both retry
paths. Reload after editing configuration. `completeReconnect(player)` supplies
an explicit local callback; omitting the player selects the next configured slot.
Duplicate or out-of-scenario callbacks are rejected.

HOME changes to speaker volume, rumble and the four connected/battery fixture
records persist in `.local/remote-state.json` through a validated local endpoint.
Config volume/rumble values seed a missing state file. Each controller record
contains `connected` and integer `battery` from 0 to 4, and can be edited locally
while the app is stopped. Reload reads it; malformed existing state is reported
and retained rather than silently overwritten. Only preference and controller records are
stored, so a reload cancels outstanding timers and never resumes a half-finished
callback. No Bluetooth identifiers, discovery or physical pairing are involved.

The renderer shows all four source battery groups, the reported number of bars,
and red low-battery state below two bars. `calc_battery` at `0x81373DD0` tests
each bar against the battery byte and chooses red/white animations. Native
controller update at `0x813742E0` selects sound index `17 + playerIndex`, starts
the matching battery blink and requests its speaker alarm after 400 ms. The
fixture retains distinct CONNECTED1–4 and connect1–4 speaker samples; the
independent 80-frame blinks continue through prompt dismissal.

Native reconnect state 5 increments the wait count and compares it with 3600 at
`0x813733C4`–`0x813733D4`; the timeout branch runs after update 3600. Rejected
start/stop operations are retried by `0x813741B8`, and `0x8137426C` programs a
100 ms alarm. The callback at `0x8137423C` sets completion only for result 1.
Prompt dismissal waits for that completion flag at `0x813733FC`, then requests
sound 21 at `0x81373450`. No separate HOME error caption or error cue was found
in these branches, so injected failures retain the original prompt and retry.

Automatic and manual fixture success still supplies a completion callback 30
updates after the configured final player. This is an explicit local shortcut:
the native early-completion branch specifically checks player four and speaker
readiness. Real callback races, radio failures and complete fourth-controller
timing equivalence remain outside this fixture. Timeout and retry counters are
source-derived, but their rendered/audio boundaries still need native captures.

The 2026-09-21 explicit Chrome diagnostic exercised ordered players 3/1/4/2,
two rejected start attempts, one rejected stop attempt, manual callbacks and a
timeout with no controllers. All settled battery counts, per-player TV/speaker
cue names, original prompt retention and dismissal states matched the fixture
expectations; WebGL reported no error. This also exposed the need to apply the
connection white setter before `btry_red`, which changes only green and blue.
The ignored diagnostic is `artifacts/home-remote-fixture/index.html`. These are
browser fixture checks, not recordings of physical reconnection or native timing.

[home-overlay.js](../web/src/home-overlay.js) owns HOME phase changes, input locks,
cues and the final close/return callback. The parent clears its overlay only at
that callback, avoiding a second close transition; return hands the black frame
to the menu entrance fade. [Tests](../web/tests/home-overlay.test.js) cover cue
order, return cancellation/acceptance, locks, volume limits, glow/shake ownership,
reconnect completion and cancellation on reset. Full native frame/audio alignment
is still required, including the reported approximate one-second glow duration;
the available original resource has not been stretched to match that estimate.
