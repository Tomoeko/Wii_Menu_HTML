# Built-in channel audio conversion

`tools/assets/channel_audio.py` converts channel banner audio with Python's
standard library and the project's existing Nintendo DSP ADPCM decoder.
Preparation no longer needs `vgmstream-cli` or a `--decoder` argument.

The exporter validates and removes the original `IMD5` and compression envelopes
before reading `meta/sound.bin`. It writes one signed 16-bit PCM pass, retaining
the original rate, channel order, sample count, and loop bounds in `channels.json`
and `channel-audio.json`. The wrapper and channel content hashes remain in the
descriptor. `sourceFormat` identifies the parsed format.

## Supported inputs

- Big-endian BNS 1.0 with one or two DSP ADPCM channels. Each channel uses its own
  coefficient table and initial predictor histories. The BNS sample count trims
  the unused samples in its final compressed frame. A loop uses the original
  starting sample through the exclusive stream end.
- Little-endian RIFF/WAVE integer PCM at 8, 16, 24, or 32 bits, or IEEE float at
  32 or 64 bits. Mono and stereo PCM/float WAVE extensible headers are accepted.
  Conversion to 16-bit preserves the original rate. Wider integer input drops
  its low bits; float input is clipped to the output range. This precision
  conversion is not lossless for higher-precision input.
- One infinite forward RIFF `smpl` loop. RIFF's inclusive final sample becomes an
  exclusive playback boundary. Other sampler-loop modes fail with an explicit
  error instead of silently changing their behavior.

Unknown codecs, inconsistent headers, invalid offsets, incomplete sample frames,
non-finite float samples, and loops outside the stream fail before writing that
sound. No external codec fallback runs. Input is limited to 128 MiB, 20 million
samples per channel, and 192 kHz. Original resources remain local and ignored.

## Validation evidence

Synthetic tests cover mono/stereo ordering, nonzero prediction history,
partially used DSP frames, source loop points, PCM precision, malformed offsets,
and an actual exporter subprocess with an empty executable search path. Shared
DSP tests separately cover signed nibbles, prediction, rounding, and saturation.

On the local supplied channel collection, the converter decoded all 13 BNS
resources, representing eight distinct compressed payloads. Every interleaved
16-bit sample matched the retained independently decoded WAVs, and all sample
counts, rates, channel counts, durations, and loop points were unchanged. The
Shop channel's original loop is `[52, 256059)` at 32 kHz. The local comparison
report records each source, payload, and decoded-PCM SHA-256; inputs and reports
are excluded from public source. A complete isolated asset rebuild also passed
with an empty executable search path, exporting all 13 channel sounds and
explicitly reporting that no optional BGM source was configured for that run.

This establishes agreement for those decoded resources. It does not establish
native mixer equivalence, sound onset timing, or complete audible transition
acceptance in the browser.

## Remaining audio dependencies and fidelity work

The browser audio runtime, original sample decoding, menu effect preparation,
menu BGM preparation and generated custom-channel example sound do not require
a third-party audio converter. The built-in BGM renderer uses the original
sequence, bank, native timing and locally read envelope/volume/pan tables.
An activated native recording takes priority and survives ordinary rebuilds.

Fresh BGM synthesis has been exercised with an empty executable search path and
an explicit Node executable. Python extracts the resources; Node and the browser
AudioWorklet share one sequence engine. Effects preserve original envelope and
AuxA automation through the verified ReverbHi filter structure and its native
two-block auxiliary return delay. Zero-length note-wait commands also wait for
native-style voice completion before the track resumes; this restores the
measured HOME focus note spacing while preserving the original sequence ticks.
The result is still labeled approximate:
native DSP interpolation, mix ramps, integer mixing and complete matched
comparisons remain in the local planning notes and the [fidelity plan](fidelity.md).
See [audio evidence](audio-cues.md).
