# Persistent Aux A for prepared effects

This records the staged implementation, source audit and remaining runtime plan.
Shared Aux playback is available only through an explicit standalone test API;
the normal application does not select it. Renderer version 10's PCM arithmetic,
prepared WAVs and activated native BGM are unchanged.
The current browser plays each effect's dry signal and baked reverb together.
That preserves individual prepared cues but gives each cue its own filter state
and makes a voice pause, stop or fade also affect its previously generated tail.

## Verified ownership and transport

The source is the supplied USA 4.3 executable, SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
The sequence archive hash is
`78c62ce1df5198bd4bb87284c6a8943ff5bb6fca7de7805080271d534d52bd78`.
Addresses below refer to that executable. No replacement DSP coefficients are
needed for this ownership work.

| Native operation | Evidence | Required behavior |
| --- | --- | --- |
| Reverb callback | `0x81555FC8`; integer returns at `0x81556308/32C/344` | Process summed Aux sends with persistent filter state; quantize the combined return once. |
| Aux initialization | `0x8155257C`; index stores at `0x815525C4–CC` | Three slots start with DSP write/read/CPU indices 0/1/2. Each channel holds 96 signed 32-bit samples. |
| Aux input/output selection | `0x81552690`, `0x815526C4` | A null callback disables new Aux input. The output getter still identifies storage; that alone does not admit it into the mix. |
| Stereo Aux command admission | `0x815532A8–B8`, `0x81553318/358` | A null input pointer skips the complete Aux A command, including return gain and return-buffer address, for the newly built DSP block. |
| CPU Aux processing | `0x81552960–A8`; rotations at `0x81552BB4–C0C` | Process the CPU slot, distinct from the current DSP input and output, then rotate all three indices. |
| Unregister Aux A | `0x81552C4C–6C` | Store a null callback/context and mark three slots for clearing. Do not immediately erase the audio buffers. |
| Deferred clearing | `0x815529AC–EC` | While the callback is null, clear the marked CPU slot and its flag. A non-null callback takes precedence over clearing. |

Registering another callback does not clear its pending flags or buffers. A
replacement may therefore process sends already in transit, and previously
processed returns may remain in another slot. A non-null replacement can admit
those returns. A newly built null-callback block does not mix them: the command
builder branches directly to Aux B before writing the Aux A command. This does
not retroactively remove an Aux command already built or issued to the DSP.
A single delay of 192 samples after filtering reproduces continuous playback,
but cannot by itself express
this ownership change. Preserve the separate input, callback and return stages.
`__AXOutNewFrame` calls Aux processing at `0x8155388C`, before its registered
sound callback at `0x815538B8`, then builds commands at `0x81553948`;
translating scene requests to that block phase needs an explicit timing contract.

HOME has an additional effect boundary beyond pausing existing sound handles:

1. `pauseOnBGM` clears menu Aux A/B/C at `0x8136BDFC/BE0C/BE1C`.
   `ClearEffect` at `0x814F8530` branches to shutdown; this path does not use
   the supplied fade-duration argument. Aux A unregisters at `0x814F85DC`.
2. HOME initializes a new ReverbHi object at `0x81372CBC`, then registers it at
   `0x81372CCC`. Its return gains become A=`0x8000`, B=C=0 at
   `0x81372CD0–CEC`. Matching preset values do not imply retained filter state.
3. Returning initializes menu effects through `0x8136BE54`. The subsequent
   [HOME profile and lifecycle audit](home-audio-aux-evidence.md) verifies its
   shutdown/restore order, entrance-completion boundary and return-bus fade.
   The number of intervening AX updates remains boundary-validation work.

The old menu filter must not be parked and resumed as a private tail. The
transport buffers must also not be unconditionally flushed when replacing it.
No capture yet establishes how many null-callback updates occur at this HOME
boundary. A same-block replacement and one with intervening clear updates need
distinct tests and a discriminating recording.

## Minimal prepared asset contract

Export buses before `SequenceEngine` adds its local reverb return and before
the WAV writer clips to signed 16-bit PCM. Recovering sends by subtracting an
existing WAV is not reliable: that file has already combined and quantized the
signals. Use one local binary resource with the following explicit descriptor:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Independent version for the bus resource. |
| `src`, `sha256` | Local resource URL and full content hash. |
| `encoding` | `s32le`, interleaved signed PCM counts, not normalized 32-bit full scale. |
| `sampleRate`, `blockFrames` | 32000 and 96. |
| `channels` | Ordered `mainLeft`, `mainRight`, `auxALeft`, `auxARight`. |
| `frames` | Exact count including initial silence, ending after the last nonzero dry/send frame. |
| `rendererVersion`, source hashes | Preserve sequence renderer, archive and executable provenance. |
| Loop metadata, when applicable | Integer frame boundaries; do not infer loops from a wet WAV's duration. |

Normalize PCM counts by 32768 only at the kernel boundary. Keeping signed
32-bit bus samples avoids introducing a separate 16-bit clipping stage before
overlap mixing. Validate exact byte length, bounds, channel order and local
origin before transfer. Publish the descriptor alongside the existing WAV;
retain the WAV as an explicitly reported compatibility path.

Export separate menu/HOME effect profiles from their original configuration
sites, even when their numeric settings match. Put those profiles in generated
local metadata, with source hashes. A prepared cue describes its sends, not
which scene owns the effect callback when those sends arrive.

An ignored prototype separated all 64 active prepared sequence effects, of
which 39 use Aux A, and recombined them through the existing ReverbHi kernel
and three-slot transport. It compared every allocated output frame with v10's
prepared WAV, treating trimmed trailing frames as zero: **zero differing PCM
values**. All bus values were integral PCM counts, with maximum magnitude
23,170 and no final clipping for an isolated cue. This checks the proposed
representation against current output; it does not establish native accuracy.
The 65th generated sequence is BGM and was excluded from this effect audit.

For the 39 wet effects, source buses end after a combined 692,095 frames, versus
2,624,104 frames in their baked WAVs. Four signed 32-bit buses require 11,073,520
bytes before any deduplication. This is a concrete memory/network cost, not an
assumption that separating the tails makes the assets smaller.

The four direct-wave entries and two raw drag loops need explicit routing
metadata before joining this path. Their absence from sequence packages is not
proof that native Aux sends are zero. Keep them on their documented existing
path until their original voice configuration is traced.

## Runtime implementation order

1. The sequence kernel now accepts `{ auxiliary: 'external' }` as its third
   constructor argument. `renderBuses(mainLeft, mainRight, auxLeft, auxRight)`
   fills four equal-length `Float32Array` outputs using the existing partial
   block cursor. It preserves the 96-sample scheduler and integer arithmetic.
   Default construction and `render()` retain local reverb and existing output.
2. The optional staged writer emits signed 32-bit buses and an additive
   `audio-buses.json` sidecar. It requires an empty output directory outside
   input assets, including through symlink aliases. It does not change the
   ordinary exporter, WAV catalog, manifest or runtime selection.
3. `SequenceAuxiliaryBus` provides the pure three-slot transport, with
   `replaceEffect(effectOrNull)` and fixed-size `processBlock` calls. Its
   injected effect has `process(channel, normalizedSample)`, as ReverbHi does.
   Owned callbacks can instead expose in-place `processBlock(left, right)`.
   `SequenceAuxiliaryEffect` uses that interface to clear the menu chain's
   first two complete CPU callbacks without advancing ReverbHi; a HOME direct
   callback processes immediately. This leaves generic transport clearing and
   previously queued output independent of the callback wrapper.
   Tests cover every ring phase, same-block replacement, zero to three
   disabled updates, retained old returns and tails with zero new sends.
   Each call constructs a new staged block using an entry-time callback and
   admission snapshot. Null admission produces no Aux input or return in that
   block while its one deferred CPU clear still occurs. The caller retains
   output already constructed by an earlier call. This synchronous model's
   write/read/process/rotate order is not a claim about native wall-clock
   scheduling: the original rotates CPU slots before its sound callback and
   next command build. Mapping HOME requests to those phases remains work for
   runtime integration and native capture.
4. The standalone effects Worklet now owns native-rate source cursors, summed
   main/send buses, one Aux A state, the transport and one final conversion
   from 32 kHz to the device rate. It mixes static cues and verified loops;
   host-rate `AudioBufferSourceNode` output never enters its reverb kernel.
   It does not own BGM, so it cannot claim a shared native final mix with a
   separate Web Audio background source.
5. Adapt `audio.js` effect ownership to worklet handles. Carry unique request
   IDs and epochs across asset fetch, transfer, scheduling, completion, reset
   and destruction. Snapshot current handles for HOME pause; later HOME sounds
   remain active. Stop/pause changes future sends while the bus continues.
   Master mute/volume stay after the bus. Report compatibility playback and
   initialization failures without playing both versions of the same cue.
6. Use the existing HOME-only `pauseMenuAudio`/`resumeMenuAudio` boundaries for
   callback changes after validating their native phase; keep preview BGM
   suspension separate. Full blackout invalidates voices and pending requests
   and unregisters effects. Do not substitute an instantaneous buffer erase
   for the native deferred clear semantics. Destruction of the browser context
   can discard all state because no future output is possible.

Prepared post-send buses can model shared tail ownership, but cannot exactly
recreate every dynamic voice operation. Native pause gain changes the voice
before integer send stages; multiplying an already quantized bus by a fade is
not identical. Arbitrary pitch/pan changes also require original per-voice
state. Preserve those limitations, or route the existing sequence definitions
and original waves through live voice engines in the same worklet when that
arithmetic is implemented. Do not silently label a stem-level fade as native
AX envelope equivalence.

The transport and static-overlap controller are separately testable; existing
application playback still uses prepared WAVs. No application effect ownership
or scene scheduling has changed.

## Staging and compatibility

Run the optional export from the maintained project with prepared assets:

```sh
node tools/assets/render_sequence_buses.mjs \
  --assets web/public/assets \
  --output artifacts/audio-buses-stage
```

The sidecar has schema version 2; sequence bus descriptors retain schema 1,
and the sequence renderer remains version 10 because its sample mathematics
did not change. It records the source catalog hash,
per-cue sequence/content hashes, source provenance and integer loop markers.
`effectProfiles.menu` contains the extracted menu ReverbHi configuration,
driver hash and explicit `callback: "menu-chain"` ownership. The loader rejects
old schema-1 sidecars and missing or incompatible callback metadata. Regenerate
the optional sidecar; all 64 PCM resources and descriptors are unchanged.
It does not claim to provide a HOME scene profile or its lifetime.
`unrenderedSends` explicitly reports Aux B/C commands outside this contract.
Without the optional WSD resources it lists six direct-wave/raw-loop entries
separately and leaves BGM untouched. To include the four verified finite WSD
voices, first extract their original data into a separate empty directory:

```sh
python3 tools/assets/wsd_audio.py \
  --archive path/to/IplSound.brsar \
  --native-content path/to/extracted-content \
  --assets web/public/assets \
  --output artifacts/audio-wsd-resources
node tools/assets/render_sequence_buses.mjs \
  --assets web/public/assets \
  --wsd-resources artifacts/audio-wsd-resources \
  --output artifacts/audio-buses-with-wsd
```

WSD descriptors use schema 2 with explicit `sourceKind`, definition provenance,
stereo output mode and baked archive gain ownership. The loader rejects mismatched
gain and source class. The resulting stage contains 68 cues and still excludes
the two dynamic drag loops. See the [WSD source and native comparison](audio-inactive-routes.md).

Future integration can attach each `sounds[name]` descriptor to the matching
audio entry under an optional `buses` field after validating the catalog hash.
Keep existing `src`, gain, loop markers and rendering labels intact for clients
using WAVs, and copy the resulting audio catalog into `manifest.audio` together.
Bus-capable clients must validate the new schema before selecting that route;
old clients continue to use `src`. The standalone writer does not perform this
activation. No normal preparation step currently invokes it.

Staged binary stems for all 64 effects reconstruct **zero differing PCM values**
against active v10, including the allocated trailing-zero interval. Default
local rendering also remains bit-identical for all 64. All 71 active audio
hashes are unchanged and `manifest.audio` still equals the catalog. MESSAGE_SCROLL
retains its full 39,936-frame period, including silence at its loop boundary.
Focused checks pass 69 JavaScript regressions and 12 sequence asset tests;
the complete asset suite passes 124 tests. The privacy audit reports no findings.
These checks establish backward compatibility and transport behavior, not
native waveform or HOME transition equivalence.

## Explicit static-overlap API

`createSharedEffects` in `web/src/shared-effects.js` accepts a caller-owned
`AudioContext`, destination, base URL and sidecar/catalog URLs. The caller must
unlock the context through its normal user gesture. This API is not imported by
`createAudio`, has no configuration default and never falls back to prepared
playback. A future owner must choose exactly one route for each request.

```js
const shared = createSharedEffects({
  context,
  destination: master,
  asset: {
    src: '/assets/audio-buses.json',
    catalogSrc: '/assets/audio.json',
  },
  baseUrl: location.href,
  onError: reportAudioError,
});
await shared.ready;
const handle = await shared.play('hover');
shared.stop(handle);
```

`ready` resolves to a boolean; `play` returns an independent handle or `null`.
Verified integer-period loops accept `{ loop: true }`. `reset()` cancels active
and pending requests, advances their epoch and unregisters the callback using
deferred clear semantics. A later owner can explicitly register a fresh menu
filter with `replaceEffect('menu')`; `replaceEffect(null)` unregisters it.
`destroy()` also closes/disconnects the node and cancels pending initialization,
but does not close the caller's context. Cached bus data transfers once per cue
to the worklet and remains available across resets.

The loader verifies the source audio catalog hash and each PCM content hash,
checks local URLs, dimensions, loop bounds and driver provenance, and retains
signed 32-bit counts without `decodeAudioData`. Ordinary effects are bounded
to sixty seconds per resource; this API is not a BGM player. The engine sums
all voices before the shared callback and final output clipping. Its maximum
of 64 simultaneous prepared handles is a browser resource bound, not a native
voice-allocation equivalence claim. Callback changes apply when constructing
the next 96-sample block. Already constructed mixed output remains in the
engine's cache until consumed; this is distinct from a return still stored in
the Aux transport ring.

The four cues declaring Aux B sends require an explicit source-backed inactive
route: `cancel`, `HOMESE_CANCEL`, `HOMESE_CLOSE_CONTROLLER` and
`WIPL_SE_SK_CANCEL_CLOSE`. The stage now includes ordinary-menu routing that
declares B/C callbacks inactive; profiles without it still reject these cues.
See the [native routing and direct-voice audit](audio-inactive-routes.md).
The four finite WSD voices require the optional audited extraction above; the
two raw drag loops remain absent. Dynamic gain, pan, pitch,
pause and the HOME profile are also rejected, rather than ignored or mapped
to a partial implementation. Master mute/volume can remain on the caller's
destination gain after the complete mix.

All 64 sequence cues pass the real loader and static engine with zero PCM
differences from v10 **after two idle menu startup callbacks**. Immediate
initialization/replacement now clears the first two CPU callbacks, as the menu
wrapper does, and may discard arriving sends. It retains already queued
returns and does not advance the fresh filter during those clear callbacks.
Separate tests distinguish that boundary from ordinary initialized playback.
The later null-command admission correction passed 67 focused tests, including
all ring phases, zero-gap unregister/re-register, preservation of retained slots,
and unregister during partial consumption of an already constructed block.
Before and after that correction, a fresh comparison of the 60 cues admitted by
the earlier sidecar without inactive-B routing found zero PCM differences from
v10 after two idle startup callbacks; all 71 activated asset hashes remained
unchanged. The other four sequence cues were explicitly excluded by that
sidecar's routing contract. Reports are retained as
`shared-effects-command-admission-before.json` and
`shared-effects-command-admission-after.json` in the ignored audio residual
audit, alongside `native-aux-command-admission-proof.json`. These checks establish
the staged admission behavior and settled playback compatibility, not the
timing of an already-issued native DSP command or HOME scene-to-block alignment.
Tests also exercise overlap before clipping, shared tails,
loop/stop lifetime, pending catalog/PCM/Worklet initialization, reset epochs,
processor failure, disposal and the actual Worklet class's 48 kHz output and
irregular callback sizes. The isolated browser fixture is retained at
`artifacts/browser-qa/shared-effects-static/shared-effects-check.html`.

A real in-app browser check at 48 kHz also passed ten visible lifecycle states:
initialization, two overlapping handles, held loop, null callback, fresh menu
callback, loop stop, another loop, reset, player destruction and owner-driven
context close. This check predates the menu startup-clear addition. Replacement
kept the loop alive; reset left no voices and no
callback. Destruction retained the caller's running context until its owner
closed it. Pending counts, player errors and browser warnings/errors were zero.
The source snapshot and observations are in that fixture directory's
`browser-source.json` and `browser-validation.json`. This verifies real Worklet
loading and static ownership behavior, not waveform accuracy, audible quality,
native HOME timing or processing time against the audio deadline.

The schema-2 callback update was also exercised in a real 48 kHz Worklet:
initialization, held loop, fresh menu replacement, null callback, reset,
destruction retaining the caller context, and owner-driven context close all
passed. Pending/error counts and console warnings/errors were zero. Evidence is
`artifacts/browser-qa/shared-effects-menu-callback/browser-validation.json` and
`browser-source.json`. This second DOM lifecycle check includes the startup
wrapper but does not measure its two-block waveform; that result comes from
the original instructions and focused block tests. It predates the subsequent
explicit inactive Aux B routing addition.

The subsequent ordinary-menu routing bundle was exercised in a real 48 kHz
Worklet across eight recorded states: initialization, accepted CANCEL cue,
held loop, null callback, fresh menu callback, reset, player destruction and
owner context close. There were no pending/player errors or console warnings.
Evidence is `artifacts/browser-qa/shared-effects-menu-routing/browser-validation.json`
and `source.json`. It proves admission and lifecycle for the inactive Aux B
contract, predates WSD admission, and makes no waveform claim.

The WSD bundle then passed a real 48 kHz Worklet lifecycle check. The four
finite cues obtained handles 1–4 together, naturally completed to zero voices,
replayed as handles 5–8, then reset to zero. Destruction retained the caller's
context; owner close shut it down. All seven recorded states had no player
errors or console warnings/errors. The evidence is
`artifacts/browser-qa/shared-effects-wsd/source.json` and
`browser-validation.json`. This verifies admission and finite lifecycle,
separately from the retained native no-disc waveform comparison.

The [HOME source audit](home-audio-aux-evidence.md) now establishes the profile
and scene callback order, including entrance-completion initialization and
return-bus fading. Remaining integration must choose and validate its AX update
phase and export the HOME-owned profile. Do not wire the existing
`pauseMenuAudio` boundary to an arbitrary instantaneous bus reset. Native
dynamic pause gain also needs per-voice arithmetic before integer send stages;
the static stem API deliberately does not pretend to implement it.

## Validation gates

- Preserve v10 single-cue output exactly after menu startup clears complete.
  Include nonzero sends, controller changes, stereo independence, callback
  sizes that cross 96-sample blocks, silent gaps and loop boundaries.
- Compare one shared filter with separately rendered tails for overlapping
  cues. The retained 200 ms HOME focus experiment differs by peak one PCM
  count and RMS 0.272909 over three seconds. That is a kernel diagnostic, not
  native acceptance or evidence that sharing alone explains a roomy mix.
- Verify voice pause/stop does not freeze an ordinary shared tail, new HOME
  voices are unaffected by the previous-handle snapshot, and cleared epochs
  cannot reappear after delayed fetch/ready/ended messages. Test muted and
  suspended contexts, replacement while loading, full blackout and destroy.
- Record isolated HOME focus as a control, then two focus entries 150–300 ms
  apart with BGM paused and a long quiet tail. Also record HOME open/close
  while an existing menu cue is still sending. Retain source/runtime hashes,
  DSP bytes, interaction markers and a cleanly finalized recording.
- Fix alignment and gain from the isolated control. Report joint-stereo RMS,
  peak, differing samples and residual windows around sends, replacement and
  late tails. Compare both old and new routing without subtracting a modeled
  cue from native audio. Keep linear SRC and unresolved coefficient limits
  explicit in both measurements.
- Exercise the real Worklet in the browser at the actual device rate, with
  rapid overlap, pause/resume, mute, scene replacement and destroy. Check
  errors and CPU time against the 3 ms native processing budget. Synthetic
  callback tests alone cannot close native or physical-console acceptance.

Ignored evidence is retained in `artifacts/audio-residual-audit/`:
`native-aux-callback-replacement-proof.json`, `native-aux-buffers.json`,
`native-home-aux-transition-proof.json`, `probe_aux_bus_contract.mjs`,
`persistent-aux-contract-probe.json`, `shared-reverb-6400.json`,
`staged-aux-bus-validation.json`, `validate_staged_aux_buses.mjs`,
`shared-effects-runtime-validation.json` and `validate_shared_effects_runtime.mjs`.
The callback startup audit adds `native-home-aux-profile-proof.json`,
`native-menu-aux-startup-proof.json`, `shared-effects-menu-callback-validation.json`
and `validate_menu_callback_runtime.mjs`. Its staged sidecar is retained in
`staged-v10-buses-menu-callback/`; normal assets are unchanged.
