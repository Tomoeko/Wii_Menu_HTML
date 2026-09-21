# HOME auxiliary effect ownership

This audit defines the callback contract needed before the staged shared-effects
API can follow HOME transitions. The prepared route now uses the verified
entrance-completion pause event; full Aux scene integration remains open.
Evidence is the supplied USA 4.3 executable, SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
Addresses below were checked in the original instructions and data. The ignored
record is `artifacts/audio-residual-audit/native-home-aux-profile-proof.json`.

## Entrance and profile

HOME's `calc` dispatch table at `0x81645518` maps state 1 to `0x81373170`.
That branch waits while the selected entrance animation is playing. Once it
stops, `0x813731A0` calls sound initialization; `0x813731AC` then requests sound
index 0, `HOMESE_HOME_BUTTON`, before entering state 2. Animation controllers
advance earlier in the same `calc` call, at `0x81372F40–58`. The existing HOME
visual controller represents this as its 21-update entrance completion.

`init_sound`, `0x81372C18`, performs the following operations in order:

1. Invoke application event 0 at `0x81372C48`. The System Menu callback at
   `0x81347AD0` routes this to `pauseOnBGM`, `0x8136BD8C`. When the menu's BGM
   handle container exists, this pauses BGM, the existing 16 effect handles
   and banner sound, using the existing five-update voice pause request. It
   then clears Aux A/B/C at `0x8136BDFC/BE0C/BE1C`.
2. Save the three return volumes, effect allocation hooks, and Aux A callback
   and context. The callback is read at `0x81372C78`, **after** the application
   has cleared its effects. For the normal initialized menu this saves a null
   callback, not the old menu reverb object.
3. Set HOME allocation hooks, write its six ReverbHi fields, and initialize a
   new effect at `0x81372CBC`. The object is at HOME instance offset `0x630`.
4. Register callback `0x81555B40` with that object at `0x81372CCC`. Set Aux A
   return volume to `0x8000`, B/C to zero at `0x81372CDC/CE4/CEC`.
5. Dispatch application event 1, which the System Menu ignores, and mark HOME
   sound initialized at `0x81372D14`.

`ClearEffect`, `0x814F8530`, immediately branches to shutdown. The argument 250
passed by `pauseOnBGM` does not create a 250-update reverb fade on this path.
Aux A unregisters at `0x814F85DC`. If there is no registered effect chain,
shutdown returns without another unregister; this distinction matters when
modeling repeated clears.

| Parameter | HOME field offset | Original constant | Value |
| --- | --- | --- | --- |
| Pre-delay | `0x788` | `0x816946D8` | 0 seconds |
| Time | `0x780` | `0x81694700` | 2.5 seconds |
| Coloration | `0x778` | `0x81694704` | 0.5 |
| Damping | `0x784` | `0x816946D8` | 0 |
| Crosstalk | `0x78C` | `0x816946D8` | 0 |
| Mix | `0x77C` | `0x816946DC` | 1 |

These six values equal the menu parameter block at `0x8160F048`, in its order
`preDelay, time, coloration, damping, crosstalk, mix`. `AXFXReverbHiInit`,
`0x81555A54`, selects early mode 5, fused mode 0, early gain 0, fused gain 1,
null input/output buses, output gain equal to mix and send gain 0. Equal numeric
profiles do not retain the old delay lines: HOME uses a newly initialized object.

The menu's wrapper is different from HOME's direct callback. `initFx`,
`0x8136B37C`, selects Aux A, creates the effect through `0x815F655C`, and appends
it through `0x814F8420`. The latter registers the sound-system effect-chain
callback `0x814F8620` at `0x814F84B8`, with context 0 for Aux A.

That wrapper also has a startup clear that HOME bypasses. When appending the
first effect to an empty chain, `0x814F84E8–F0` writes a per-bus counter of 2.
The chain callback decrements it at `0x814F8750–60`, then clears `0x180` bytes
in each channel at `0x814F8768–74` without invoking any effect. Thus its first
two CPU callbacks discard 96 signed 32-bit samples per channel each and do not
advance ReverbHi. This is distinct from the unknown null-callback gap and the
generic transport's deferred clear flags. After a menu replacement, an already
processed return can still be consumed from its separate slot, while the first
two CPU slots are cleared. A fresh HOME direct callback has no such counter.
The original instructions are retained separately in
`artifacts/audio-residual-audit/native-menu-aux-startup-proof.json`.

HOME sound requests go through application event 5 (`0x813770B0–B8`). The menu
callback starts the indexed cue through `0x8136B578` and returns 1, bypassing
HOME's private archive-player fallback. New HOME effects therefore belong to
the menu's ordinary sound-handle pool. They do not inherit the earlier snapshot
of paused voices merely because the HOME callback is active.

## Close and return to Wii Menu

During ordinary retraction, state 16 at `0x81373848` computes the remaining
animation fraction with single-precision subtraction/division at
`0x8137387C–94`. It calls `fadeout_sound`, `0x81377118`, with that fraction.
Once the animation stops it writes state 17 and requests fraction zero. The
cleanup branch runs on the following `calc`, not within that same branch.

For initialized HOME sound, `0x81377154–6C` multiplies the fraction by the
original float 32768 at `0x81694754`, truncates toward zero with `fctiwz`, retains
the low 16 bits and sets Aux A return volume. This is a return-bus fade. It is
separate from filter state, transport contents, dry cue gain and the browser's
master volume. The private HOME archive player also has its own gain update;
that does not imply a gain change to application-owned effect handles.

State 17 at `0x8137389C` performs these operations:

1. Write state 18. Stop sounds in HOME's private archive player if present.
2. If HOME sound was initialized, shut its ReverbHi down at `0x813738F8`,
   restore the saved callback/context at `0x81373904`, restore allocation hooks,
   then restore A/B/C return volumes at `0x81373918/920/928`.
3. Complete controller/speaker cleanup, then dispatch application event 4 at
   `0x813739C4`. The zero-byte store at `0x813739CC` targets instance offset
   `0x8B`, not the sound-initialized flag at `0x8E`; it must not be described as
   clearing that sound flag. The preceding state change prevents this branch
   from performing teardown again on the following update.

The selected-button value 3 explicitly skips audio teardown and application
events in these branches. This audit's ordinary close and confirmed Wii Menu
return contract must not be generalized to that separate path.

The System Menu's event-4 handler checks the exit-animation flag. Ordinary
close calls `pauseOffBGM`, `0x8136BE34`: `initFx` at `0x8136BE54` initializes
a fresh menu effect **before** resuming BGM, effect handles and banner playback.
The old pre-HOME reverb is not restored. Application-owned HOME dry voices are
not implicitly stopped by stopping the private HOME archive player; their
remaining sends can encounter the newly owned callback.

For confirmed Wii Menu return, event 3 previously sets the exit flag at
`0x81347B44`. Event 4 instead calls `resetAllSound`, `0x8136BC14`, which stops
the effect pool, BGM and banner and clears the three effect chains. It does not
resume the previous menu filter or its voices. The black-fader state 19 reaches
state 17 through its own completion branch, separate from state 16 retraction.

## Contract and remaining integration work

The future owner needs distinct operations for voice pause, callback ownership
and Aux return gain. At entrance completion it must pause the previous handles,
destroy/unregister menu effects, save the resulting callback state, initialize
the HOME profile, set return volumes, and only then request the opening cue.
At close it must apply the return fade, destroy HOME, restore callback/volumes,
then either initialize a new menu effect before resuming or reset all voices.
Fresh menu registration must include its two-callback startup clear; direct
HOME registration must bypass it. Store menu and HOME profiles separately in
local metadata, despite equal values.

The prepared route's HOME controller now emits sound initialization after its
21-update entrance, immediately before requesting `HOMESE_HOME_BUTTON`.
`menu-audio.js` acquires HOME pause ownership only at that explicit event.
Preexisting BGM, banner and effect voices therefore continue through entrance;
effects started during entrance join the paused snapshot, while the new HOME
cue does not. An interrupted entrance never pauses or spuriously resumes audio.
Ordinary close retains the prior playback cursors and preview's independent
BGM suspension; confirmed blackout retires sources before releasing HOME pause.

Executing the original state-1 instructions at `0x81373170–0x813731B8` confirmed
the animation-playing gate and the `init_sound`-before-`play_sound(0)` order.
That private check observes outgoing calls without executing their complete
audio implementation. Its report is `native-home-entrance-execution.json` in
the ignored audio residual audit. Scene regressions combine real HOME/menu
controllers with a simulated AudioContext and verify source lifetimes, the
21-update boundary, partial/large updates, canceled entry, close and blackout.
This establishes callback ownership and ordering, not AX sample-phase alignment.

A later isolated browser run used real HOME input and inspector single-update
stepping from the ordinary grid. BGM remains playing at entrance update 20,
pauses at update 21 before the opening cue, stays paused at ordinary close 38
and resumes at close 39. Five PNG/sidecar pairs retain sound requests, audio
ownership and logical time in `artifacts/browser-qa/release-855/`. These confirm
the browser boundary without measuring waveform equality or native sample phase.

The staged static API currently exposes menu/null callback replacement and
reset only. Its menu callback now includes the verified startup clear. The
isolated callback model distinguishes `menu-chain` from `home-direct`, but the
sidecar/API still provides no HOME profile or scene integration. Independent
Aux return-volume control and source-equivalent voice pause arithmetic remain
unimplemented.

The [three-slot transport](audio-aux-bus-plan.md) must survive callback
replacement. Unregister marks slots for deferred clearing; it does not erase
every pending send or return immediately. Registering a new callback can process
old sends still in transit and admit a retained return. However, a newly built
stereo DSP command list skips the whole Aux A command when the callback is null:
`0x815532B8` branches to Aux B at `0x81553358`, bypassing the Aux A gain and
return address. The output getter's retained pointer is not evidence that such
a block mixes the return. Output from an already built or issued command is a
separate case. Neither the native call order nor matching presets
establish a fixed number of null-callback AX updates during initialization and
allocation. Individual registration and chain mutation calls protect their
state, but the complete HOME initialization sequence is not one demonstrated
atomic audio operation. Keep zero-gap and intervening-clear cases separate.

Pure transport and callback tests cover all ring phases, fresh replacement,
zero to three null updates, retained processed returns admitted by non-null
replacements, silent newly built null blocks, two complete startup
clears without advancing ReverbHi and HOME's direct behavior. Single-cue v10
compatibility is measured after two idle menu callbacks; immediate replacement
has its own tests and deliberately discards pending startup sends. The retained
standalone real Worklet check predates this startup-clear addition and
establishes static browser lifecycle only. Native HOME acceptance
still needs a recording with a preexisting sending voice and marked open/close
boundaries, aligned dry and wet measurements, and the actual AX block phase.
Source-derived scene events can be implemented without claiming that unresolved
sub-frame timing or native waveform equivalence has been measured.

The command-admission correction is confined to the staged transport. Engine
tests consume part of an already constructed 96-sample block, unregister the
callback, and verify that its cached output survives while only the next newly
constructed block loses Aux output; its dry voice continues. This establishes
the staged API boundary, not the native scene-to-AX phase. Original command
builder and frame-order instructions are retained in
`artifacts/audio-residual-audit/native-aux-command-admission-proof.json`.
