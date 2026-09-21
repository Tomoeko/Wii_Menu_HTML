# Audio cues and current limits

The Disc preview uses `WIPL_ME_NO_DISC_BANNER` from the supplied IplSound archive.
It starts when the preview is ready, shares channel-preview cancellation, pauses
under HOME, and fades with the return zoom. Keyboard and Message Board controllers
emit original `WIPL_SE_*` identifiers; the player resolves these to prepared PCM
without substituting unrelated button cues.

The audio exporter includes the current menu/keyboard/board cues and all 22
original `HOMESE_*` symbols from the local USA 4.3 archive. Direct wave sounds
are decoded from original wave data. Sequenced effects use original notes,
samples, native tick timing, envelope tables and pan lookup. AuxA routing and
the ReverbHi filter structure are implemented; complete AX output equivalence
remains unverified. `MSG_DISP` and `CHAR_INPUT`, `CHAR_DELETE`, `CHAR_DECIDE`
randomize pitch bend; prepared versions use the center value. They are not exact
native recordings. Missing assets remain reported as missing.

## Built-in background preparation

Fresh preparation creates menu music with Python extraction and a shared
JavaScript synthesis engine, using only Python/Node built-in libraries. The
previous path omitted BGM by default and required external MIDI/SoundFont
conversion when explicitly requested. The new path reads the original RSEQ and
RBNK, resolves all 43 used instrument regions and six original waves, and renders
the 1,185 notes on 12 tracks. It retains controller writes during sustained notes;
freezing volume at note-on would lose the sequence's fades.

`native_audio_tables.py` reads the supplied USA 4.3 executable, identified by
SHA-256 `47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
Original attack, sustain, decibel and pan tables remain local extracted data.
They are not embedded in public source. These binary locations were inspected
through Binary Ninja:

| Behavior | USA 4.3 binary evidence |
| --- | --- |
| Envelope attack/decay/release | `0x814FF138`, `0x814FF25C`, `0x814FF274`, `0x814FF31C` |
| Velocity squared; instrument volume, pan and tuning | `Bank::NoteOn`, `0x814FBF6C` |
| Decibel and pan lookup | `0x8150F31C`, `0x8150F374` |
| Shared integer sequence clock | `SeqPlayer::Update`, `0x81504A50`; threshold `416` |

The sequence sets tempo 114 after opening its tracks. Tick metadata prevents
those earlier-opened tracks from incorrectly retaining tempo 120. The original
loop runs from ticks 383 to 6527, corresponding to samples 134,208 to 2,286,528
on the 32 kHz, 96-sample update clock. The offline file includes two traversals
and repeats the second, retaining prior notes' tails at the repeat boundary.
Its loop markers are 71.454 to 138.714 seconds. Source hashes, renderer version,
output hash, note count and peak level are recorded in generated metadata;
changed or missing PCM causes regeneration.

The first startup phrase is a separate original wave, `WIPL_SE_WII_START`,
rather than part of the looping `WIPL_BGM_MENU` sequence. It is exported as
`backgroundIntro` and starts with the first sequence pass on a fresh menu or
HOME return. Native DSP captures already contain this mixed wave and carry an
explicit manifest marker so the runtime does not play it twice.

The built-in BGM file is labeled `original-sequence-built-in-dry-approximate`:
this original sequence contains no AuxA send commands. It uses linear sample
interpolation; versions 6 and 7 add the verified integer volume stages and
96-sample envelope ramps described below. The live definition is also labeled
dry when it has no auxiliary send; definitions with ReverbHi carry a reverb label.
Passing conversion tests is not acceptance of native sound equivalence.

An initial comparison against the locally activated native capture (WAV SHA-256
`616c3f4a83288191e2c39309e742b6759a50947f3465a3a6074e9a8a35630963`)
aligns the built-in output by 33 samples. Joint stereo waveform correlation is
0.99862 over 5–16 seconds, 0.99858 over 16–32 seconds and 0.99848 over
32–60 seconds; fitted gain remains between 0.9992 and 0.9999. The earlier
five-second comparison contained the separate startup wave; the exporter now
retains that wave explicitly instead of treating it as a missing sequence note.
The capture is preserved unchanged. These measurements support the shared tick
clock and overall mix, while the residual waveform differences still prevent a
claim of exact DSP equivalence.

## Selectable live playback

`audio.backgroundMode: "realtime"` loads the generated sequence definition and
original instrument PCM through an AudioWorklet. `"prepared"` remains the
default and plays the generated WAV or activated native capture. There is no
silent substitution when a chosen live backend fails; the audio status reports
the failure. Preparation exports live resources in either mode.

Both paths run `sequence-engine.js`, including the same 32 kHz clock, tables,
controllers and loop. A worklet resamples this output to the device rate and
retains oscillator positions, envelopes and tick state during preview/HOME
pauses. Full menu restart destroys that state. Tests compare offline blocks
with irregular live callback sizes across repeated loops. A real 48 kHz
AudioWorklet smoke test verified nonzero output, silent pause, audible resume,
silent destruction and no processor/page errors. This establishes lifecycle
behavior, not native waveform equivalence.

## Native reverb and effect sequencing

USA 4.3 `System::initFx` at `0x8136B37C` selects AuxA and passes the parameter
block at `0x8160F048` through `0x815F6C08`. The menu chooses zero pre-delay,
2.5-second decay, coloration 0.5, zero damping/crosstalk and output gain 1.
`AXFXReverbHiInit` at `0x81555A54` selects fused mode zero, early gain zero and
fused gain one. These parameters and delay lengths are read from the supplied
executable rather than embedded original resources.

`AXFXReverbHiExpCallback` at `0x81555FC8` and initialization at `0x81556890`
were inspected through Binary Ninja. The implemented stereo path sums three
feedback combs, runs two all-pass filters, a one-pole low-pass and a final
channel-specific all-pass. Arithmetic follows the callback's single-precision
operations. Reverb receives each voice's original AuxA level: command dispatch
at `0x8150248C` stores D9 at track offset `0x90`, and channel update at
`0x81505998` divides the three send bytes by 127. Writes during a sustained
note update its send. ADSR overrides retain their original order at note-on;
later writes affect subsequent notes. AuxB/C are retained in metadata but the
menu's configured effect is on AuxA.

The 2026-09-21 native capture `roadmap-menu-return` isolates HOME focus while
BGM is paused. The marked DSP byte interval 11,907,072–13,549,568 contains the
focus cue and quiet tail. An initial left-channel correlation alignment gave
joint waveform correlation 0.99537 and best-fit synthesized-to-native gain
0.98381. Native/synthesized RMS was 2.17/2.12 PCM units at 100–500 ms and
0.485/0.489 at 0.5–1 s. This is promising evidence for routing/decay, not exact
acceptance: that initial alignment did not resolve the two-note timing, and DSP
interpolation, ramps and integer summation still differ. Subsequent audits below
resolve the auxiliary latency and the missing note-completion wait separately.
Evidence remains in ignored `artifacts/audio-native-comparison/`.

The subsequent residual audit found a specific missing auxiliary delay.
`__AXAuxInit` (`0x8155257C`) initializes DSP write/read and CPU callback buffer
positions to 0/1/2. `__AXGetAuxAInput` (`0x81552690`) and `__AXGetAuxAOutput`
(`0x815526C4`) select those DSP positions; `__AXProcessAux` (`0x81552880`) runs
the callback on the CPU position and rotates all three modulo three. Each
channel spans `0x180` bytes: 96 signed 32-bit samples. The return reaches the
mix **two blocks, or 192 samples, after its send**. This is separate from the
menu preset's zero ReverbHi pre-delay. Renderer version 4 retains this bus delay
across render calls and sequence loops; the dry path is unchanged.

The retained HOME focus window independently gives the strongest tail alignment
at +192 samples. The comparison below uses native offset 108,357 and one gain
factor, 0.992024, fitted to the louder dry note. It uses that same alignment and
gain for both renders and every interval; notes were not retimed. Values are
joint stereo residual RMS in signed 16-bit PCM units, rather than correlation
alone:

| Interval after alignment | Before | With native auxiliary delay |
| --- | ---: | ---: |
| 0–1 s | 4.776 | 4.282 |
| 40–100 ms | 3.596 | 0.502 |
| 100–500 ms | 3.007 | 0.539 |
| 0.5–1 s | 0.683 | 0.196 |

At 100–500 ms, normalized residual RMS falls from 1.388 to 0.249 and peak
absolute residual from 26.90 to 2.07 PCM units. The first 40 ms is unchanged:
the two native dry sample onsets are 1,056 samples apart, while the exported
one-tick interval rendered as 384 samples. The next audit resolves that 672-sample
spacing difference from the native parser and completion ordering. Integer
sends/mixing, DSP ramps and interpolation remain open. These residuals do not
establish exact conversion.

The ignored `artifacts/audio-residual-audit/` directory retains the immutable
before/after WAVs, native disassembly, fixed-alignment measurement script and
JSON report. The revised focus WAV SHA-256 is
`8c45cae0dfa6cae68843a0e595c7b0a817d522d910e83dfcbc8de84e98b5cbbf`.
A fresh isolated export produced all 72 sounds, including the startup wave; the
BGM sequence retained its previous PCM hash
`044c5156d1779181fef0c6022ed889fae766ecc963814550a1824950429b9f9c`.
The Chrome 153 AudioWorklet test captured 60,000 samples at 48 kHz and matched
the shared offline engine with zero sample error after the same resampling.
This verifies the delayed path runs consistently in both backends; it is not a
comparison against native hardware output.

Renderer version 5 preserves native zero-length note completion waits. The
original MML parser at `0x81501D88–0x81501DA4` checks the track's note-wait flag,
stores the note length and sets `noteFinishWait` when that length is zero.
`SeqTrack::ParseNextTick` (`0x81505458`) then waits for the entire track channel
list to clear before processing its next command. The HOME focus sequence has
two such notes with an explicit one-tick rest between them. The exporter retains
their original ticks **0 and 1** and marks each completion wait; it does not
replace those ticks with values fitted to a recording.

The native completion path explains the additional two musical ticks.
`__AXOutNewFrame` (`0x815537E0`) synchronizes DSP parameter blocks before calling
the sound-thread callback. `__AXServiceVPB` (`0x81554400`, including
`0x8155445C–0x81554468`) copies the completed DSP sample address back to the CPU
voice. New voice parameters reach the next DSP update; its resulting address is
available on the following synchronization. `SoundThreadProc` (`0x8150C170`)
updates sequence players before `AxVoice::Update` (`0x814F8B68`) checks the
completed address. `IsPlayFinished` (`0x814F9B2C`) recognizes the native zero
buffer, and callbacks at `0x814FE194` and `0x81505C78` remove the track channel.
For the 199-sample first wave, completion is therefore processed after the
sequence update at sample 384. The sequence resumes at sample 672, reads its
explicit rest, and starts the second wave at sample 1,056. The shared engine
retains that track-local wait and callback order across arbitrary render blocks.

A full-window search against each original PCM wave finds one match above 0.98
correlation for each: native window frames **107,685 and 108,741**, exactly
1,056 samples apart. This supplies no evidence for an additional matching focus
pair or a capture-start overlap. The source-driven wait explains the spacing
without that hypothesis. The retained capture was cleanly finalized and uses
32 kHz stereo DSP PCM; the interaction-log byte boundaries are observation
marks, not emulated update timestamps.

The version 4/5 comparison fixes the native alignment at the first wave
(107,685) and fits a single gain of 0.992024 to the second dry wave. Both renders
use that same alignment and gain for every interval:

| Interval after first onset | Version 4 residual RMS | Version 5 residual RMS |
| --- | ---: | ---: |
| 0–1 s | 70.029 | 0.382 |
| 0–40 ms | 349.276 | 1.064 |
| 40–100 ms | 18.283 | 0.318 |
| 100–500 ms | 3.163 | 0.445 |
| 0.5–1 s | 0.727 | 0.176 |

The one-second normalized residual is 0.00769, with peak error 9.70 PCM units;
the quieter 100–500 ms tail still has normalized residual 0.190. The changed
alignment means this table should not be compared row-for-row with the earlier
auxiliary-only table. The revised focus WAV hash is
`81ece0d3c67908c9793dcabffbc51e1da05e80093dd8cc4003af4ddfbe2b2d1c`.
Six archive cues contain a completion wait followed by another note: HOME focus,
HOME nothing-done, and channel/button/date/board focus. BGM has no such wait and
retains its prior PCM hash. Loops containing these waits are rejected pending
a separate timing audit. The exact-conversion gate remains open for integer
mixing, ramps, interpolation and persistent auxiliary state across separate cues.
The ignored residual-audit directory retains `native-note-wait.json`, the cue
audit and `note-wait-before-after.json` with source hashes and measurement code.
The version 5 Chrome AudioWorklet fixture retains source ticks 0/1 and both
completion waits, and matches 60,000 offline-resampled samples at 48 kHz with
zero sample error and no processor errors.

Renderer version 6 adds the original integer envelope and output-send stages.
`UpdateAxVe` converts its float32 volume using 32767 and `fctiwz` at
`0x814FAA24–0x814FAA40`; `CalcAXPBMIX` converts each pan/send using 32768 and
an unsigned 16-bit ceiling at `0x814FB798` onward. The original `axDspSlave`
program is embedded at executable address `0x81683CE0`. Its DSP word offsets
`0x034C–0x0374` multiply the signed source sample by the unsigned envelope and
discard the low product bits. The main/AuxA output mixers at DSP words
`0x0BD1–0x0C20` perform a separate product and arithmetic shift before integer
accumulation. Negative products therefore round toward negative infinity at
both stages. Archive gain now participates in each voice's envelope coefficient;
each main and auxiliary send rounds independently before voices are summed.

The fresh v6 export uses the same native offset 107,685 and the earlier fixed
gain 0.9920242099; neither was refitted. Joint stereo residual RMS, in signed
16-bit PCM units, changes as follows:

| Interval | Version 5 | Integer stages |
| --- | ---: | ---: |
| 0–1 s | 0.382130 | 0.213440 |
| 100–500 ms | 0.444768 | 0.159962 |
| 0.5–1 s | 0.176376 | 0.065999 |

The first-second peak residual increases slightly, from 9.697 to 9.751 PCM
units. Sample-rate conversion remains the existing linear approximation, and
native ramps between changing volume coefficients were still open at version 6. These results
verify one improvement without establishing exact conversion. The isolated
export contains all 71 entries; BGM retains its 71.454–138.714 s loop and
4,438,848 frames, with new WAV hash
`284e3da0cab56a8e3a910294d8941cb9c9161ea4bdc451aa87d0bbd31e10cb3f`.
The corrected 39,936-frame MESSAGE_SCROLL period still matches 20 seconds of
continuous rendering with zero sample differences. Focused tests cover signed
rounding, per-voice accumulation, separate sends, timing and callback partitioning.

A separate ignored diagnostic adds the retained emulator bundle's four-tap
coefficient bank selected by the original CPU and DSP code. Combined with the
integer stages, it reproduces all 64,000 stereo PCM samples in the first second
of this capture at unit gain. That table is an explicitly approximate replacement
DSP ROM, not an original resource supplied by the WAD, and is **not used by the
application or exporter**. The bundle executable has also changed since the
recorded session hash. This result explains the retained capture's residual;
it does not establish original-console filtering. Original instruction words,
provenance, diagnostic variants and the actual v5/v6 comparison are retained in
ignored `artifacts/audio-residual-audit/`, including `integer-stage-proof.json`,
`integer-src-probe-metrics.json` and `integer-mix-before-after.json`.

Renderer version 7 adds the verified 96-sample voice envelope ramp. In the same
original executable, `Channel::Update` reads the initial envelope at
`0x814FDADC`, advances it by three milliseconds at `0x814FDD78–0x814FDD7C`,
then reads its target and calls `SetVeVolume` at `0x814FDD94–0x814FDDE4`.
`UpdateAxVe` uses the previous voice gain for the initial coefficient and the
current gain for the target. Its signed division at `0x814FAA94–0x814FAAB0`
truncates `(target - initial) / 96` toward zero. Original DSP words
`0x035C–0x0362` emit the initial coefficient first, followed by 95 increments.
The next CPU update starts from the target-derived coefficient, so the integer
division remainder does not accumulate across blocks. Main and auxiliary sends
remain immediate: `CalcAXPBMIX` explicitly zeros all twelve send deltas at
`0x814FB9A4–0x814FB9D8`.

An isolated v7 export compared with the retained native BGM uses the earlier
33-sample alignment and unit gain, with no timing or gain refit. Joint stereo
residual RMS, in signed 16-bit PCM units, changes as follows:

| Interval | Version 6 | Envelope ramps |
| --- | ---: | ---: |
| 5–16 s | 36.093149 | 12.485586 |
| 16–32 s | 41.836635 | 19.953988 |
| 32–60 s | 37.799157 | 13.607798 |
| 5–60 s | 38.692369 | 15.533070 |

Peak residual drops from 1207 to 98 PCM units over 5–16 seconds and from 1246
to 95 over 32–60 seconds. The 2945-unit peak in 16–32 seconds was unchanged;
the fresh-capture audit below identifies its separate cause. Interpolation is
unchanged, and no replacement DSP ROM
coefficients are used. The BGM retains its duration and loop points; its v7 WAV
hash is `72611e5349b96605a029691cc973350059cecb9f0f9dfc9577972d864d2efbd6`.
HOME focus and MESSAGE_SCROLL retain their v6 PCM hashes because their relevant
envelopes have no changing segment. The isolated export contains all 71 entries.
Focused tests cover positive and negative ramp deltas, first-sample order,
block-boundary reset, immediate sends and callback partitioning. Original
instruction evidence and the reproducible comparison are retained in ignored
`native-envelope-ramp.json` and `envelope-ramp-before-after.json`. These results
verify a further correction without closing native waveform equivalence.

The retained recording's 2945-unit peak occurs at aligned source sample 576,604
(18.018875 s). Its extra transient matches the original shared focus sequence
at archive offset `0x4932`, used by HOME focus, Board focus, button hover and
channel hover. All four symbols have archive volume 45 and identical rendered
PCM; audio alone cannot identify which UI target triggered it. A diagnostic
subtraction supports that attribution, but is not used as waveform acceptance
or as a replacement recording.

A fresh recording on 2026-09-21 used a separate copied native profile, the same
supplied WAD, no save state and no menu input after dismissing Health. The host
pointer stayed on the native title bar; startup and endpoint inspection showed
an idle menu without a pointer or tooltip. The capture finished normally with
7,623,392 stereo 32 kHz DSP frames. Its emulator executable hash is
`7c43b3e6226322cd0fd9acf491a58212e72530c6d1afbe5895c9b34cc809ec24`;
the finalized DSP WAV hash is
`8e637751b75ee53c70b6292885815b4276507ef5d5fafd052b0bb1ce8e96f130`.
Independent correlation locates the BGM at absolute sample 2,068,545, 33 samples
after the AX-aligned start 2,068,512. That alignment and unit gain remain fixed
for all following measurements; no effects are subtracted.

| Fresh native interval | Version 6 RMS | Version 7 RMS | Version 7 peak |
| --- | ---: | ---: | ---: |
| 5–60 s | 38.107289 | 14.012335 | 119 |
| 75–130 s | 38.931153 | 14.525343 | 119 |

Across 5–138.714 seconds, v7 residual RMS is 14.169916 PCM units with peak 119.
The old and fresh recordings are bit-identical over 0–16 and 32–60 seconds;
the old recording also contains additional differences over 65–72 seconds.
It must therefore not serve as a cue-free BGM oracle. The validated fresh
recording is now activated, retaining unchanged PCM and the existing
5.194–72.454 s loop markers;
its 2048-sample join neighborhood matches exactly. Its WAV hash is
`6aac2ed032d85137df00902bcc8ad94d1bba8eb59c1f36a673a5983f281072f1`.
The new recording establishes a cleaner emulator comparison, not physical Wii
equivalence. The source capture, quiet markers and loop validation remain in
ignored `artifacts/captures/audio-bgm-clean-v7/`; the residual audit retains
`focus-contamination.json`, `peak-source-context.json`,
`fresh-bgm-before-after.json` and their reproducible scripts.

Renderer version 8 quantizes each source step to the original unsigned 16.16
parameter. `UpdateAxSrc` performs float32 multiplication by the sample rate
and division by 32000 at `0x814FA684–0x814FA688`, then scales by 65536 and
converts to unsigned integer at `0x814FA6B8–0x814FA6C8`. The conversion helper's
`fctiwz` is at `0x815F93D8`. `AXSetVoiceSrc` stores ratio high/low and the
initial zero fraction at `0x8155552C–0x81555544`. Original DSP words
`0x071F–0x0759` load that fixed ratio and fractional state, advance the ratio
per sample and retain the 16-bit fraction for the next block. The renderer
keeps its existing linear interpolation; no filter coefficients are replaced.

Against the finalized fresh capture, the same absolute alignment and unit
gain give these joint stereo residuals:

| Interval | Version 7 RMS | Version 8 RMS | Version 8 peak |
| --- | ---: | ---: | ---: |
| 5–60 s | 14.012335 | 11.501951 | 111 |
| 75–130 s | 14.525343 | 11.924831 | 110 |
| 5–138.714 s | 14.169916 | 11.627479 | 111 |

The isolated 71-entry v8 export retains the BGM duration and loop markers;
its built-in WAV hash is
`4554383efe93b934371c8a9d78e502837e110f26c01a691fac005d05b5a91fd1`.
HOME focus and MESSAGE_SCROLL PCM are unchanged. Focused tests check the
44100-to-32000 fixed ratio, float32 conversion and unsigned saturation, plus
an independently calculated source edge after 1000 output samples and callback
splits. Original instructions and measured before/after results are retained
in ignored `native-src-q16.json` and `src-step-before-after.json`. The remaining
residual still prevents a claim of exact conversion.

Renderer version 9 preserves each original float32 envelope arithmetic stage.
`SetDecay` performs two single-precision divisions at `0x814FF300/304`;
`SetRelease` does the same at `0x814FF3A8/3AC`. The low-rate branch multiplies
by 1/128 and then divides by five. `EnvGenerator::Update` separately rounds
the rate-times-three product and the subsequent subtraction at
`0x814FF1F8/200` for decay and `0x814FF248/24C` for release. Collapsing those
steps changes the decibel-table index at occasional boundaries. For rate 112,
the seventh decrement is `-17.999998092651367`, rather than `-18`.
The regression exercises both phases and checks the resulting audible sample,
using synthetic tables with distinct adjacent entries.

The production renderer retains linear interpolation. With the same native
alignment of 2,068,545 and unit gain, its residuals remain dominated by that
filter difference:

| Interval | Version 8 RMS | Version 9 RMS | Version 9 peak |
| --- | ---: | ---: | ---: |
| 5–60 s | 11.501951 | 11.503793 | 111 |
| 75–130 s | 11.924831 | 11.921430 | 110 |
| 5–138.714 s | 11.627479 | 11.625842 | 111 |

An isolated emulator diagnostic separates this arithmetic from the filter.
It uses the recording runtime's replacement coefficient ROM only inside ignored
audit scripts, never in the application or exporter. Its independently fixed
alignment is 2,068,544, reflecting the causal four-tap model; gain remains one.
Before the envelope correction, the 5–60 s residual was RMS 0.452109, peak 15.
With the verified arithmetic it is RMS 0.014704, peak one. Over 5–138.714 s,
1,828 of 8,557,696 compared PCM values differ, each by one count. This supports
the independently verified CPU arithmetic; it does not establish original
hardware coefficients or production-renderer equivalence. The v9 built-in WAV
hash is `a82169fd7d7cb1b7397ded63bacc544cb955acae97517edd722ad5d0a203fdfa`.
The clean activated native recording remains unchanged.

## Active sequence audit and envelope lookup rounding

The 71-entry USA 4.3 audio catalog contains 67 sequence entries and four direct
wave entries. Two sequence entries use the separately documented looping drag
wave path, leaving 65 shared-engine definitions including BGM. An executed
command inventory found no LFO, portamento or sweep commands in this set. The
remaining command exceptions are four randomized pitch-bend cues and surround
pan writes in `WIPL_SE_OUTPUT_MODE_SELECT`; full output-mode routing remains
outside the current stereo synthesis claim. Four cancel-family entries also
write Aux B, whose complete scene-dependent routing remains separate work.
`MSG_DISP` and `CHAR_INPUT` request the range −32 to 32, `CHAR_DELETE` −16 to 16,
and `CHAR_DECIDE` −24 to 24. The fixed center rendering is now documented for all
four, rather than only the Message Board cue.

Renderer version 10 corrects a reachable envelope lookup boundary.
`EnvGenerator::GetValue` divides its float32 level by ten at `0x814FF130`;
`Util::CalcVolumeRatio` clamps the result and multiplies it by ten at
`0x8150F350`, then truncates it for the decibel-table lookup. These operations
cannot be algebraically cancelled. Symbol Page Open's second voice reaches
`-25.999998092651367`; the original divide yields `-2.5999999046325684` and the
multiply yields exactly `-26`, selecting index 878 instead of v9's 879.
Both offline Python export and live playback use this one shared JavaScript
implementation. Synthetic progression tests also exercise the Python export
bridge and resulting PCM, without requiring original resource files.

A staged comparison retained all 65 definition outputs and all 71 catalog WAVs
before activation. Five WAVs changed: Symbol Page Open differs at 6,716 PCM
values, with maximum difference 17 and RMS difference 0.386942 over its trimmed
WAV; the four cancel-family exports differ at only two or three PCM values,
each by one. These are v9-to-v10 change measurements, not native residuals.
The other 60 shared-engine outputs, including the complete built-in BGM WAV,
remain identical. Its hash stays
`a82169fd7d7cb1b7397ded63bacc544cb955acae97517edd722ad5d0a203fdfa`.
The activated clean native BGM also retains its hash
`6aac2ed032d85137df00902bcc8ad94d1bba8eb59c1f36a673a5983f281072f1`.
No DSP coefficient substitution was used. The private audit retains
`active-sequence-command-inventory.json`, `native-envelope-lookup-proof.json`,
`envelope-lookup-boundaries.json`, `active-envelope-value-impact.json`,
`v10-staged-comparison.json` and `activated-clean-v10.json`.

Renderer version 11 preserves `Bank::NoteOn`'s initial note-gain arithmetic.
The original code divides velocity by 127 at `0x814FC054`, squares that
float32 ratio at `0x814FC05C`, divides instrument volume by 127 at
`0x814FC060`, then multiplies and stores the float32 result at
`0x814FC064–0x814FC068`. The previous combined double-precision expression
crossed integer envelope boundaries. For velocity 39 and instrument volume
127, the native coefficient is 3090 instead of 3089; velocity 50 and volume
115 produce 4598 instead of 4599. Both boundaries now have signed PCM
regressions through the live kernel, staged dry/Aux exporter and Python WAV
bridge.

A private instruction check executed the unchanged six PPC instructions for
all 16,384 input pairs. The production helper's complete float32 output matched
that execution, and seven pairs changed the downstream integer coefficient
relative to the previous expression. The dependency-free application and
importer do not require that diagnostic runtime. An isolated 71-entry export
kept all 70 effect WAVs identical, including all 64 shared-engine effects.
The complete built-in BGM changed 608 PCM values by one count over 4,438,848
stereo frames, with RMS difference 0.008276 and unchanged duration and loop
points. Its new WAV hash is
`52a946740f279df520e4d69ee36e75a0f7d5db8611634f21d8cb467ab45bf5f5`.

With the retained native alignment of 2,068,545 and unit gain, the 5–138.714 s
production residual changes from RMS 11.625842 to 11.625857 PCM units; peak
remains 111. This corrects the independently verified control arithmetic;
linear interpolation still prevents complete native PCM equivalence. No DSP
coefficient replacement or active export change was made, and the selected
clean native BGM retains its recorded hash. Ignored evidence includes
`native-note-gain-proof.json`, `native-note-gain-execution.json`,
`native-note-gain-js-validation.json`, `note-gain-impact.json` and
`v11-staged-comparison.json` under `artifacts/audio-residual-audit/`.

## Original DSP coefficient input still required

The original AX instruction image selects three coefficient banks at DSP data
addresses `0x1000`, `0x1200` and `0x1400` (pointer words `0x0DBA–0x0DBC`).
Its four-tap loop at words `0x071A–0x0759` uses four source-history samples and
128 fractional phases. The supplied executable establishes this structure,
but these pointers refer to separate DSP data ROM, not embedded coefficient
words in that AX instruction image.

A focused inventory of supplied resources, the known runtime/profile locations
and conventional local Dolphin coefficient paths found only the bundled/source
replacement table, SHA-256
`d7741279c2e8ec5c5fb318f8fbdd6de6bf583520d288e836a5383233a4238179`.
No original table was verified among those inspected locations. This is not
a claim about other uninspected user files.

The required local input is an original hardware `dsp_coef.bin` data-ROM dump:
4096 bytes containing 2048 big-endian 16-bit words, with hardware model,
dump method/tool version and capture date recorded. The three SRC banks occupy
the first 3072 bytes, each with 128 phases of four signed coefficients. A future
optional local importer should validate exact length and byte order, reject the
known replacement identity as original evidence, retain the complete dump hash
and provenance, and extract those banks without authoring a substitute table.
Unknown provenance must remain unverified; a filename or plausible coefficient
shape does not prove origin. Imported words belong only in ignored local
resources. The default renderer and accuracy labels should remain unchanged
until that input and independent comparison support a stronger claim.

The ignored residual audit retains `native-envelope-arithmetic-proof.json`,
`envelope-float32-before-after.json`, `envelope-arithmetic-probe-metrics.json`
and `coefficient-inventory.json`, with separate production and diagnostic inputs.

Prepared effects include their individual tails; only trailing PCM zeros are
trimmed. Linear superposition approximates the persistent native auxiliary bus,
but cancellation/fade of an effect also affects its baked tail. The held drag
loop retains its original PCM and browser-owned lifetime; its AX envelope is
still separate work. Randomized pitch and unsupported modulation remain
explicit limitations, not replacement tones.

The [persistent Aux A implementation plan](audio-aux-bus-plan.md) records the
source-backed asset contract, callback replacement rules and validation gates.
Its explicit bus-render interface, optional staged exporter and pure transport
reconstruct all 64 prepared sequence effects without changing active assets;
a standalone shared-effects Worklet reproduces the 60 cues with supported routes.
Normal runtime routing and HOME ownership remain unintegrated; the standalone
API admits Aux B-writing cues only under the source-verified ordinary-menu
inactive-bus contract; it rejects direct/raw entries and dynamic voice controls.
The [routing audit](audio-inactive-routes.md) records that distinction and the
remaining direct-voice work.

## Preview return and full menu restart

Entering a channel preview suspends the background track instead of discarding
it. The audio player retains the decoded buffer and playback cursor, including
the samples consumed by the existing five-update fade. Returning with **Wii
Menu** resumes that cursor after the reverse zoom finishes. Moving between
previews does not change it, and closing HOME while still inside a preview
resumes only the banner sound.

HOME's confirmed **Wii Menu** reboot is a separate boundary. It discards the
old background, banner, one-shot effects and held loops before releasing HOME's
pause, keeps the loading display silent, and starts fresh background music when
the new grid is handed over. It also cancels effect requests waiting for browser
gesture resume or decoding, including prepared tracks already fading without a
current track handle. The audio context, decoded cache and user volume/mute remain
available to the new menu.

The supplied USA 4.3 executable's HOME sound callback at `0x81347AD0` sets its exit
flag for event 3 (`0x81347B40–0x81347B44`). Event 4 then calls `resetAllSound`
at `0x81347B28`; ordinary HOME closure takes the resume branch at `0x81347B38`.
The reset function at `0x8136BC14` stops each of its 16 handles with zero fade,
clears the handle records, stops the BGM and banner player, and clears Aux A/B/C
through `0x814F8530`. The browser invokes its reset when the existing return fade
reaches blackout. Retained instruction evidence is in the private
`audio-residual-audit/native-home-audio-lifecycle-proof.json` artifact.

Tests run the real menu-state routes against a simulated AudioContext and check
actual buffer-source offsets, loop wrapping, fade completion, stale `onended`
callbacks and deferred decoding. Blackout regressions additionally cover active
and pending effects, replacement loops and delayed real-time initialization.
These checks verify playback lifetime and cursor preservation; they do not
establish sample-aligned native audio parity.

A 361-frame browser HOME return capture additionally exercised the application
callback with audio enabled. All loading, outgoing fade and black frames report
zero active effects and no background playback; the fresh background starts
during grid handover. The browser console stayed clear. The private
`browser-qa/home-restart-audio-ui/audit.json` retains the per-frame states and exact
source snapshot. This measures application lifetime, not the audible waveform.

Ordinary HOME opening pauses existing scene audio after the 21-update entrance,
immediately before its opening cue. Native state 1 calls `init_sound` at
`0x813731A0`, then `play_sound(0)` at `0x813731AC`; initialization dispatches
application event zero at `0x81372C48`. The browser now uses that explicit
initialization event instead of pausing immediately when the overlay appears.
Effects started during entrance join the paused snapshot; the subsequent
opening cue does not. Canceling entrance leaves playback untouched. Tests use
the real HOME/menu controllers and simulated AudioContext to check the boundary,
retained BGM/banner cursors, preview suspension, close and confirmed blackout.
The [HOME ownership audit](home-audio-aux-evidence.md) records the original
instruction check and remaining Aux integration limits.

Ordinary HOME opening also pauses the effects that already exist. Native
`pauseOnSE` at `0x8136BEB4` visits the current 16 handles and requests
`Pause(true, 5)`; `pauseOffSE` at `0x8136BF28` requests `Pause(false, 5)`.
New HOME sounds use `startSEIndex` at `0x8136B578`, while `BasicSound::InitParam`
clears their pause flags and sets pause gain to one (`0x814FC5CC–0x814FC608`).
The browser therefore snapshots existing effects, including pending gesture or
decode requests, and allows later HOME cues to play. Held loops retain their
loop points, pitch-adjusted cursor and latest parameters; releasing one while
paused cancels its later resume.

`BasicSound::Pause` at `0x814FC8B8` scales a reversed fade's duration by its
remaining gain distance, truncates it and uses at least one update. Its update
routine advances the pause counter at `0x814FCE30–0x814FCE44` and freezes the
player only after the final gain update (`0x814FD200–0x814FD24C`). Prepared
effects now consume that five-update fade before suspension, resume their
remaining samples with a separate pause gain, and avoid replaying effects that
finished during the fade. The browser schedules these source-derived gain steps
at 60 updates per second. Its Web Audio clock phase and baked effect tails still
differ from native AX scheduling and persistent Aux processing; this lifetime
correction does not establish waveform equivalence. Tests cover full and
reversed fades, stale completion, pitch changes, loop wrapping, delayed loads,
short effects and blackout while paused.

A native handle pause affects its player and voices, not a premixed reverb tail.
Aux processing has separate ownership. This HOME route clears the menu's three
effect buses (`0x8136BDFC`, `0x8136BE0C`, `0x8136BE1C`), then initializes HOME's
ReverbHi and registers its Aux A callback (`0x81372CBC`, `0x81372CCC`). Returning
initializes the menu effects again through `0x8136BE54`. The prepared browser
cue contains its already-mixed wet tail, so pausing and resuming that buffer also
freezes and resumes its tail. It does not reproduce this native bus replacement
or independent wet-tail processing. Shared Aux state and scene ownership remain
The A04 browser implementation is complete; the current tests establish
voice/request lifetime adaptation. Native mix and AX comparison remains a
Section 7 release gate.

## Page arrows and Message Board navigation

The original USA 4.3 executable calls the same `WSD_SELECT` symbol for these
accepted page actions. The following call sites were read from the supplied
binary through Binary Ninja; the symbol choice is independent of the quality
of the browser's prepared waveform.

| Action | Original cue | Verified call site |
| --- | --- | --- |
| Channel grid page | `WSD_SELECT` | `0x813AD8DC` in `0x813AD8B8` |
| SD Card Menu page | `WSD_SELECT` | `0x813E03AC` in `0x813E0398` |
| Channel preview left / right | `WSD_SELECT` | `0x813BB018`, `0x813BB074` |
| Message Board previous / next date | `WSD_SELECT` | `0x81393954`, `0x813938B0` |
| Message Board calendar date selection | `WIPL_SE_DATE_SELECT` | `Calendar::onTrigDate` after `Date::ON_TRIG` |
| Message Board → Wii Menu, Calendar, or Create | `WIPL_SE_DECIDE` | shared transition call `0x81392F08` |

Message Board now emits these cues from its scene controller after accepting
the action. Locked actions and arrows at the supported date limit are silent.
The host must not add a generic confirm/cancel sound to these actions, including
the equivalent physical-keyboard paths. The channel preview's **Wii Menu**
button has its own `WIPL_SE_BT_PUSH` call in handler `0x813BAC50`, followed by
`WIPL_SE_CH_UNSELECT` at `0x813B7784` when the reverse zoom begins. The button
handler directly invokes that zoom path when resources are ready; accepted
browser button presses preserve both cues, while repeated locked presses add
neither. This differs from the Message Board return button. These mappings do not establish
sample-identical playback or native waveform decoding.

An independent check of the prepared `WSD_SELECT` wave used a separate local
DSP decoder. Each channel's 14,627 PCM samples matched this exporter's output
exactly at 44,100Hz. No replacement sample or equalization was applied. A
separate host defect sent preview arrows to the hidden grid
footer: transition frames cleared its focus and immediately reentered it,
replaying the hover cue every update. Hover routing now restricts the footer
to its visible grid or top-level Message Board controls. Repeated-frame tests
cover this sound burst separately from wave decoding. Preview focus and press
also use the shared arrow controller, retaining focus through page changes.

## HOME and Wii Remote audio

HOME emits its original identifiers instead of a generic button click. Opening
waits for the entrance animation; Wii Remote Settings requests Select at the
press and Open Controller when the lift finishes. Volume steps distinguish
normal, newly reached limits and already-at-limit cues. Return confirmation,
rumble changes and reconnect have their own original symbols. The complete
index mapping and executable addresses are in [HOME evidence](home-menu-source-notes.md).

The WAD's `homebutton/SpeakerSe.arc` supplies five separate original PCM effects:
volume and connections for players one through four. Preparation exports mono
6000Hz WAVs. Native playback reads 40 signed 16-bit big-endian samples per
approximately 6.666667ms alarm before encoding them for the physical remote.
Browser playback preserves the source PCM but does not emulate the remote's
ADPCM delivery or acoustic response.

`wiiRemote.volume` scales these speaker effects independently of changes to the
browser master setting. It defaults to `0.7`; `wiiRemote.rumble` defaults to
`true`. Reconnect uses `wiiRemote.reconnectDelayMs`, default `3000`, as an explicit
local wait after its prompt arrives. It does not pair controllers. Connection
speaker playback is delayed 400ms after the simulated connection, following the
original alarm request. Hardware completion timing remains a fixture.

## Channel and memo drag

`ChannelSelect::moveDrag` and `BoardObject::calc` pass movement distance into
`System::holdSEwithPosDis`. The USA 4.3 binary at `0x8136b8a0`, read through Binary
Ninja and checked against its PPC instructions, sets pan to `x / 304` and volume
to `min(1, 2 * distance / 304)`. The constants at `0x816946a8` are 2, 1, 30 and 60.
The original branch changes pitch above a distance of 30. Browser movement is
normalized to source updates before those parameters are applied.

The former constant-volume raw loop made a stationary grab sound continuous and
high-pitched. A grab now starts with zero movement gain; motion updates that gain,
and holding still returns it to zero. Releasing, cancelling, or losing focus
stops the loop, including a sample still being decoded. These controls reproduce
the source lifetime and modulation inputs; sample-envelope equivalence still
needs a native audio comparison.

## Posted Memo movement loop

`WIPL_SE_MESSAGE_SCROLL` is a sequence with two finite dry notes at ticks 0 and
6, and a loop from tick 0 to 24 at tempo 120. Its musical loop does not occupy
an integer number of the player's 3 ms updates. At 32 kHz the first cycle starts
are 0, 8064, 16032, 24000, 31968, 39936 and 48000 samples. Repeating the previous
two-cycle 16032-sample WAV therefore changed subsequent note timing.

The exporter now treats only this audited cue specially: five musical cycles
restore the integer sequence clock's accumulator phase. It renders 39936 frames
and records `loopStart: 0`, `loopEnd: 1.248`, `loopFrames: 39936` and
`loopSequenceCycles: 5` in the audio entry. It requires the verified loop shape,
instant ADSR settings, no reverb, and voices that finish before the next cycle;
unverified variants fail instead of silently using the same boundaries. Other
cues retain their prior export plans. The reader still owns the sound's start
and stop, as described in [Message Board evidence](message-board.md).

An isolated export from the supplied archive produced WAV SHA-256
`4305e215c3201b095e42cdefee8e10c925d0b8c6ab0a5f394f00786cfd952b9a`.
Repeating that period matched 640000 frames (20 seconds) from the shared sequence
kernel with zero quantized PCM differences. Repeating the old 16032-frame prefix
instead differed in 92582 channel samples, first at frame 24002, with RMS PCM
difference 676.8344. A separate authored-wave regression exercises the same clock
period and leaves an unrelated loop's export unchanged. These are shared-kernel
comparisons, not acceptance against a native AX capture or physical hardware.

## Verification

`audio.test.js`, `menu-audio.test.js`, `drag-audio.test.js` and
`home-overlay.test.js` cover deferred
loading, cancellation, HOME pause/resume, Disc ownership, loop boundaries,
source-symbol lookup, and stationary/moving drag gain. The exporter tests DSP
ADPCM decoding and source sequence timing with independent synthetic fixtures.
A passing trigger test does not establish sample-identical AX output.
