# Retained native evidence

This ledger distinguishes current local evidence from inherited reports. It does
not declare 1:1 fidelity. Original recordings and generated comparisons stay in
ignored local artifacts. The [fidelity plan](fidelity.md) defines acceptance
separately from implementation and successful capture completion.

## Availability audit

On September 21, 2026, the previously documented `address-settings-16x9`,
`settings-board-16x9` and `roadmap-16x9` capture directories were absent. The
63,363-image recording and its paired reports therefore cannot support current
reproducible acceptance. Their earlier findings are preserved as explicitly
unverified [historical notes](historical-fidelity-notes.md), not current results.

## Current capture provenance

Fresh USA 4.3 references execute the supplied WAD in the isolated local runtime:

- WAD SHA-256: `bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.
- Runtime revision: `1363d7ce48a3b7cefaabc0e81faab527f87705d0`.
- Executable SHA-256: `32ad9b490106c953fdc313ac1de528ead54655cbc028428a8ca15333552b4c05`.
- ARM64 JIT, Metal, USA NTSC 16:9, raw XFB images at 836 × 456.
- These are emulator observations, not physical-console recordings.

`artifacts/captures/roadmap-menu-regressions` retains 6,673 presented images.
Its bounded Mii entry near ordinals 6130–6158 established that the footer and
date retain the channel zoom camera. The runtime aborted with a locale error
after saving a paused state; exit code −6 is recorded. Its images remain useful
observations, but it is not a clean audio-session completion.

`artifacts/captures/roadmap-menu-return` continues from the recorded saved-state
hash, with an explicitly valid runtime locale. It records Mii return, HOME
focus audio, Data Management/GameCube entry and Disc Channel opening. Each input
annotation reports an observation boundary rather than a simulation timestamp.
The session stopped cleanly with exit code 0 and 25,155 images. Both WAV headers
are valid: the DSP stream contains 13,662,824 stereo 16-bit samples at 32 kHz;
the DTK stream contains 20,494,152 at 48 kHz. It additionally includes Board
entry/return from menu pages one and two.

`artifacts/captures/data-management-followup` reuses the same local NAND and
records the populated Wii Channels grid, the empty mounted SD Card grid, tab
focus, Internet Channel focus and its detail page. It stopped cleanly with
exit code 0 and 27,025 images. Anchors 6710 and 18002 show the six manageable
downloaded channels; 19467 shows SD tab focus, 20506 the selected SD grid,
22846 Internet Channel focus, and 23880 its detail. The six banner-content
hashes match the browser's imported catalog. The private input-identity report
and `verified-anchors.json` retain those checks and image hashes. This capture
establishes reference states; complete transition alignment is still required.

## Comparison limits

The menu inspector records browser controller updates at an explicit 60 Hz step,
including frame zero after the selected input event. Native PNG ordinals are
presented images and may repeat or skip simulation poses. Monotonic pose matching
does not measure elapsed time. The original browser framebuffer is 640 × 456;
any horizontal normalization of a native presentation is explicit in the report
and cannot establish raw-pixel equality.

[Channel transition notes](menu-transition-regressions.md) track the current
controller corrections and bounded comparisons. [Audio notes](audio-cues.md)
record native/BGM and HOME focus comparisons, including alignment, excluded
contamination and outstanding mixer differences. Complete interaction sequences,
4:3, other supported versions/regions and target-browser acceptance remain open.
