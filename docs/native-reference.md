# Record the original menu for comparison

Run the supplied original System Menu in an explicitly selected Dolphin
executable and isolated user profile. The emulator is a capture tool; original
WAD resources and executable behavior are the reference. A recording made with
an emulator is not a physical-console recording or a browser candidate.

The launcher does not download or build an emulator, discover private workspace
paths, create a NAND, repair tickets or modify setup/EULA values. Supply a
working isolated profile that contains the matching System Menu title. Its
Wii/title/00000001/00000002/content/title.tmd must exist. Keep the normal emulator
profile separate and close another instance using the capture profile.

## Explicit launch

From this project:

~~~sh
python3 tools/reference/run_native.py \
  --emulator /path/to/DolphinExecutable \
  --profile /path/to/isolated-profile \
  --wad /path/to/menu.wad \
  --runtime-version YOUR_RUNTIME_VERSION \
  --output /path/to/new-capture \
  --aspect 16:9
~~~

Use the exact executable accepted by the runtime, not an application-bundle
directory. The paths above are placeholders. Choose the backend explicitly
when Metal is unavailable. The launcher accepts:

- --aspect 16:9 or 4:3; widescreen is default.
- --video-backend NAME; Metal is default.
- --cpu-core NUMBER only when the selected runtime's numeric meaning is known.
- --save-state FILE for a compatible local state.
- --print-command to inspect the generated command without launching.
- --output DIRECTORY, which must not already exist. Without it, a timestamped
  directory under this project's artifacts/captures/ is used.

The launcher requests native internal resolution, no enhanced texture pack or
supersampling, raw-XFB PNGs, disabled duplicate-XFB skipping and DSP audio.
Verify the requested options against the selected runtime. Actual image
dimensions are recorded after exit; do not assume a particular framebuffer
size from the logical 832×456 projection.

## Provenance and stopping

capture-session.json records input and emulator hashes, runtime version,
requested video mode/backend, capture description, timestamps and optional
save-state hash. After the process exits it records exit code, final PNG count,
last image ordinal and measured image size. Private absolute input paths are
not needed in a public report.

Use the emulator's normal Stop and then Quit so audio and metadata finish
writing. Review the recording before analysis. Retain:

1. Raw Frames/framedump_N.png images and Audio files.
2. Capture metadata and exact original input hashes.
3. Input annotations, setup/channel state, clock/date and pointer pose.
4. Renderer/converter revision and matching browser capture settings.
5. Explicit normalization/resampling choices and analysis commands.

Image ordinals count presented images, not wall-clock time or guaranteed game
updates. Audio uses its own sample clock. Paused emulation, repeated XFBs and
asynchronous loading make casual frame-number subtraction unreliable.

## Deterministic interaction

Pause before configuring input. In the runtime's Wii Remote TAS input dialog,
disable live input, set pointer coordinates and button state, and use frame
advance. Release held buttons after the intended input. Save a state before
each repeatable case and record its hash. Avoid moving the pointer across
animated icons during an idle-loop recording.

For all twelve icon animations, retain a reviewed stable range with unchanged
channel order, no pointer/tooltip occlusion and no page transition. Analyze
every image in that range, not only sampled stills.

## Evidence status

Older health/menu/SD/Settings/Address Book, clean-icon and keyboard/Memo sessions
were deleted. Their prior measurements are historical observations, not current
reproducible references. Replacement captures require review and paired browser
comparisons before any acceptance status changes.

[Analysis commands](../tools/reference/README.md) explain region geometry,
per-frame atlases, session indexing and explicit frame comparison.
[Fidelity criteria](fidelity.md) define what a matching result must establish.
