# Inactive menu buses and remaining direct voices

The optional shared-effects stage can now play all 64 prepared sequence cues
and four finite WSD voices under its explicitly declared ordinary-menu routing.
This does not change `createAudio`, defaults, active WAVs or the native BGM
recording. The two dynamic raw drag loops remain excluded.

Evidence is the supplied USA 4.3 executable, SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`, and
IplSound archive, SHA-256
`78c62ce1df5198bd4bb87284c6a8943ff5bb6fca7de7805080271d534d52bd78`.
All addresses below were checked against original instructions and data.

## Why ordinary-menu Aux B is inactive

The generic audio manager contains an Aux B chorus creation call. Its presence
alone does not establish that the System Menu installs a chorus:

1. `System::initOnMemory`, `0x8136B280`, writes effect heap sizes A=`0x30000`,
   B=0 and C=0 at `0x8136B2D0/D4/D8`. It calls its virtual initializer at
   `0x8136B2E8`. The constructor selects vtable `0x81642948`; its original
   initialize entry at `0x81642950` is `0x815F6278`.
2. That initializer passes the effect arguments at offset `0x18` into
   `0x815F6B6C`. The loop skips each zero-size heap at `0x815F6B98–BA0`.
   `AudioFx` construction stores a null heap at `0x815F636C`.
3. The generic initializer attempts Aux B chorus creation at `0x815F62D8`.
   The creation path `0x815F6898` tests the null heap at `0x815F68B8–C8` and
   returns before calling `AppendEffect`. It never registers an Aux B callback.
4. The AX manager initially unregisters A/B/C at
   `0x814F7780/78C/798`. System-specific `initFx`, `0x8136B37C`, configures
   only Aux A. `__AXGetAuxBInput`, `0x81552760`, returns a null DSP input
   pointer when B has no callback (`0x81552788–90`). A sequence's nonzero
   B-send value does not create that missing input destination.

HOME also clears menu effects before installing its direct Aux A callback,
and explicitly sets the B/C return volumes to zero. Ordinary close initializes
menu Aux A again; it does not allocate a B effect heap. That source behavior
supports an inactive B route here. It does not establish routing for arbitrary
external channel code or another application that registers its own callbacks.

The four previously excluded entries are `cancel`, `HOMESE_CANCEL`,
`HOMESE_CLOSE_CONTROLLER` and `WIPL_SE_SK_CANCEL_CLOSE`. All have one note and
the same controller pattern: release=105 and Aux A=10 at tick 5, Aux B=16 at
tick 9. Their sequence metadata still records Aux B as an unrendered send.
The stage profile now explicitly declares:

```json
{
  "context": "system-menu-usa-4.3",
  "inactiveAuxiliaryBuses": ["auxB", "auxC"]
}
```

Only this complete routing declaration, on the `menu-chain` profile, permits
those sends to have no destination. Profiles without routing metadata retain
the previous rejection. Unknown contexts, partial declarations and HOME-scoped
claims fail validation. The active player cannot change this routing context
after admitting an asset. The API still rejects raw entries and unsupported
dynamic controls, and creates only one playback owner for each accepted cue.

The optional sidecar remains schema 2; PCM descriptors remain schema 1 and
sequence rendering remains version 10. All 64 stem descriptors and bytes are
unchanged. All 64 sequence cues now pass the real loader and shared engine
against v10 with zero differing PCM values **after two idle menu callbacks**.
All 71 active WAV hashes remain unchanged. This proves compatibility with the
current approximation, not native waveform acceptance.

## Finite WSD voices

The original four direct sounds are RWSD version 1.2, each with one note,
pitch 1, pan 64, surround pan 0, main send 127, Aux A/B/C sends 0 and ADSR
`127/127/127/127`. Their source inventory is:

| Catalog entry | Source rate | Channels | Frames | Archive volume |
| --- | --- | --- | --- | --- |
| `page` (`WSD_SELECT`) | 44100 | 2 | 14627 | 96 |
| `WIPL_SE_SK_PAGE_CHG` | 44100 | 2 | 14627 | 120 |
| `discPreview` | 32000 | 2 | 128540 | 87 |
| `WIPL_SE_BOARD_SELECT` | 32000 | 1 | 17589 | 90 |

`ReadWaveSoundInfo`, `0x815108A8`, reads the 1.2 pitch/pan/send fields at
`0x81510908–3C`; `ReadWaveSoundNoteInfo`, `0x815109C8`, reads the note envelope.
`WsdTrack::Parse`, `0x81511E98`, requests note zero, applies all four ADSR
parameters at `0x81511F50–7C`, then calls the common native channel start with
length −1 at `0x81511F80–8C`. The voice ends with its sample, not a guessed
musical duration. `UpdateChannel`, `0x815119BC`, applies player gain/pitch/pan
and adds the WSD sends to player sends; its Aux loop is `0x81511C40–98`.

`WsdPlayer::UpdateAllPlayers` parses its track at `0x815114B4`, then updates
the new channel at `0x8151153C` in the same sound-thread callback. The finite
voice has no musical tick delay. `CalcAXPBMIX` checks the source channel count
at `0x814FB398–3A4` and selects source pan −1/+1 at `0x814FB3A8–3BC` for stereo.
The original constants at `0x816951F0` and `0x816951D8` verify those values;
the pan table calls are `0x814FB478–48C`. Mono uses center pan instead.

The staged `wsd-engine.js` now uses the extracted common `sequence-voice.js`
envelope/sample/integer-mix helper with those source pan endpoints. It accepts
only the verified finite, centered, dry parameter set above. The two 44.1 kHz
sources use the verified 16.16 source step, not host-rate WAV resampling.
`wsd_audio.py` reads their original fields and losslessly decoded PCM into a
separate staging directory; the existing direct WAV decoder remains unchanged.
Descriptors use schema 2, `sourceKind: "wsd"`, their definition hash,
`outputMode: "stereo"`, archive volume and `gainOwner: "buses"`. The runtime
requires the original catalog gain to match that archive volume and never
applies it again. Sequence descriptors retain schema 1. A raw-loop label,
WSD loop marker or incompatible gain owner fails admission.

Linear interpolation and unresolved original DSP coefficient provenance remain
explicit limitations. This finite path neither changes stereo sequence behavior
nor establishes support for arbitrary WSD pitch, pan, sends or modulation.

The cleanly finalized `roadmap-menu-return` native capture provides an independent
no-disc comparison. Its raw 32 kHz DSP WAV SHA-256 is
`03912a5d2f7f405e00b7ddee93a63c3edfa8552ed8a337fff6ebfcec2660dd3f`;
capture metadata records runtime `1363d7ce48a3b7cefaabc0e81faab527f87705d0`
and exit code 0. All 128,540 staged frames align at native sample 11,138,938.
After integer time alignment and one fitted gain of 0.989359045, the full cue
has RMS error 0.909821 PCM and peak absolute error 16.614428 PCM. The final
32,540 frames have RMS 0.428841 and peak 1.340261 PCM. No retiming or modeled
cue subtraction is used. The fitted gain, residual and source-filter uncertainty
remain acceptance gaps; this is not proof of exact native output or a measured
comparison against the existing browser AudioBuffer playback.

All 68 cues pass the actual sidecar loader and static runtime. The original
64 sequence outputs remain bit-identical to v10 after two idle callbacks,
and all 71 active WAV hashes remain unchanged. Focused audio checks pass 76
JavaScript tests; the full asset suite passes 127 tests. New regressions cover
finite completion across partial reads, 44.1 kHz stepping, independent stereo
channels, mono center-send flooring, gain ownership and rejected source classes.

## Dynamic drag loops remain excluded

`drag` and `WIPL_SE_BOARD_DRAG` instead share sequence program 10, key 60,
velocity 127 and wave 13, with ADSR `104/127/127/125`. Their sustained loop
therefore has a non-instant attack and release. Native movement changes user
gain, pan and pitch through `holdSEwithPosDis`, `0x8136B8A0`; the current raw
WAV loop omits the original envelope. An indefinitely repeated static stem
cannot preserve arbitrary movement, pause and release state. Keep these two
excluded until a live common-voice path can apply those controls before native
integer gain/send stages and carry the envelope through hold/stop boundaries.

Ignored evidence is in `artifacts/audio-residual-audit/`:
`native-aux-route-and-wsd-proof.json`, `native-wsd-channel-update-proof.json`,
`audit_unstaged_cues.py`, `unstaged-cue-inventory.json`,
`shared-effects-menu-routing-validation.json` and
`validate_menu_routing_runtime.mjs`. The optional stage is
`staged-v10-buses-menu-routing/`. Focused audio checks pass 69 JavaScript tests.
The subsequent WSD stage is `staged-v10-buses-wsd/`, with extracted definitions
in `staged-wsd-v10-resources/`. New evidence includes
`native-wsd-finite-proof.json`, `shared-effects-wsd-validation.json`,
`validate_wsd_runtime.mjs`, `staged-wsd-native-comparison.json` and
`compare_staged_wsd_native.py`.
