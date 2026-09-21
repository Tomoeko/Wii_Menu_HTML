# Original System Menu capture and analysis

Use explicit inputs from the standalone project:

~~~sh
python3 tools/reference/run_native.py \
  --emulator /path/to/DolphinExecutable \
  --profile /path/to/isolated-profile \
  --wad /path/to/menu.wad \
  --runtime-version YOUR_RUNTIME_VERSION \
  --output /path/to/new-capture \
  --aspect 16:9
~~~

The [recording guide](../../docs/native-reference.md) describes profile
requirements, options and provenance. No fixed workspace layout is assumed.
The launcher records original PNGs, DSP audio and input/runtime hashes. It
requests native internal resolution and disables duplicate-XFB skipping.
Measure actual PNG dimensions independently of the logical menu projection.

On macOS/Linux, the launcher checks executable identity and individual kernel
arguments before starting. It rejects another Dolphin instance using the same
resolved profile, including symlink and relative-path aliases, while ignoring
Python/shell commands that merely mention its paths. An inspection failure
stops the launch with an error; it does not disable profile protection.

Pause before deterministic interactions. Use Wii Remote TAS input with live
controller input disabled, set IR/button state and frame advance. Release A
after the intended press. Record the input sequence and a compatible save state
for repeatable cases. Stop and Quit normally to flush audio and final metadata.

Frames/framedump_1.png, framedump_2.png and so on must be sorted by numeric
suffix. These are presented images, not timestamps or guaranteed simulation
updates. Audio has a separate PCM sample clock. Previous captures and reports
were deleted; no historical image number is a currently available reference.

## Every-frame icon analysis

Pillow and NumPy are required. Review a contiguous idle range first, including
its first/last images, channel order and absence of pointer/tooltips.

~~~sh
python3 tools/reference/analyze_capture.py /path/to/capture \
  --start REVIEWED_START --end REVIEWED_END \
  --aspect 16:9 --duplicate-xfb-skipping disabled \
  --note "Reviewed unchanged page and unobstructed icons throughout this range"
~~~

The analyzer measures all adjacent RGB changes, retains every crop in lossless
indexed atlases, copies original endpoints, records decoded-source hashes and
produces a contact sheet, trace plot and rectangle review. It never rescales
source images to fit a preset.

The 16:9 preset requires 836×456 PNGs, with columns [70,238), [247,415),
[422,590), [600,767) and rows [39,126), [136,222), [231,318). The preserved
4:3 preset requires 640×480. These are original-pixel rectangles from a previous
reviewed fixture; they are not universally correct for every runtime or saved
arrangement. Their former capture is unavailable, so inspect them anew.

For another geometry, title order or region set, supply --regions regions.json:

~~~json
{
  "resolution": [836, 456],
  "regions": [
    { "name": "Disc", "box": [70, 39, 238, 126] },
    { "name": "Mii", "box": [247, 39, 415, 126] }
  ]
}
~~~

Right/bottom bounds are exclusive. Region names must be unique and rectangles
must fit the image. Each atlas records its crop size and frame lookup.
source-frames.json hashes every full decoded RGB image; frame-metrics.csv
records every frame/region pair. Identical crops can indicate static holds or
repeated presentations, not necessarily a complete loop. Native-only metrics
do not establish browser equality or exact simulation timing.

## Session indexing

~~~sh
python3 tools/reference/analyze_session.py /path/to/capture \
  --annotations /path/to/reviewed-annotations.json --end REVIEWED_END
~~~

Annotations contain manually reviewed segments and transitions. The tool
creates sheets, adjacent-image summaries and 50 ms audio-energy windows.
Its frame-change scan uses an explicit analysis downsample; raw PNGs remain
unchanged. --skip-frame-scan reuses an existing scan when updating sheets/audio.
Do not use a guessed annotation boundary as accepted event alignment.

## Native/candidate frame comparison

~~~sh
python3 tools/reference/compare_frames.py /path/to/native.png /path/to/candidate.png \
  --resampling nearest --roi corner:0,0,12,12 \
  --output /path/to/report --case "Explicitly aligned corner"
~~~

Choose regions and resampling deliberately. Reports retain hashes, dimension
mapping, samples and RGB errors. A bounded corner or text-region comparison is
not a full-frame match. Keep original images alongside normalized comparisons,
state any excluded pointer/time differences, and retain complete sequences for
animation acceptance. See [fidelity criteria](../../docs/fidelity.md).

## Full inspector sequence comparison

The Create inspector's final sidecar contains a complete `sequenceManifest`.
Compare it to an explicitly reviewed native interval:

~~~sh
python3 tools/reference/compare_sequence.py /path/to/final-sidecar.json \
  --project /path/to/Wii_Menu_HTML-Final \
  --native /path/to/native-capture/Frames --first FIRST --last LAST \
  --native-evidence /path/to/native-capture/analysis/address-transition-evidence.json \
  --regions /path/to/regions.json --output /path/to/comparison \
  --authored-source-snapshot /path/to/export-source-snapshot.json
~~~

`--native-evidence` is optional. When supplied, its `capture.wadSha256` must
match the browser sidecar. The region configuration explicitly names the pixels
used to align images and those measured afterward:

~~~json
{
  "size": [836, 456],
  "alignmentRegions": [[180, 35, 740, 190]],
  "measurementRegions": {
    "bookTop": [[180, 35, 740, 190]],
    "pageArrows": [[0, 150, 80, 215], [750, 150, 836, 215]]
  },
  "exclusions": [[650, 160, 740, 270]]
}
~~~

All bounds use original pixels, with exclusive right/bottom edges. Choose them
for the actual capture, excluding private console numbers, pointer, dates and
other changing state. Unselected and excluded pixels are blacked out in the
contact sheet and never enter the metrics. By default images are not resized or
shifted, and mismatched image dimensions are rejected.

For a reviewed presentation-width difference, explicitly record the measured
native geometry and horizontal resampling filter in the same configuration:

~~~json
{
  "size": [640, 456],
  "nativePresentation": {"sourceSize": [836, 456], "resample": "lanczos"},
  "alignmentRegions": [[0, 0, 640, 100]],
  "measurementRegions": {"header": [[0, 0, 640, 100]]}
}
~~~

Only native images are normalized to `size`; browser pixels remain unchanged.
Every native image must match the recorded `sourceSize`. Heights must match and
widths must differ. Allowed filters are `nearest`, `bilinear`, `bicubic` and
`lanczos`; the tool never guesses a filter or source geometry. Regions and
exclusions use the resulting comparison coordinates. The report records source
and comparison sizes, horizontal scale, filter, pixel-center mapping and library
versions, while input hashes continue to identify the untouched source files.

This option assumes a reviewed presentation-width difference; it does not prove
matching projection, aspect ratio or original-pixel geometry. Filter footprints
mix neighboring source pixels, so review and enlarge private-region exclusions
before sharing normalized results. Such metrics measure normalized native pixels
against browser pixels, not equality to the original native pixel grid. No
vertical scaling, translation or browser resampling is applied.

The tool minimizes RGB absolute difference with nondecreasing native ordinals;
it can repeat or skip native images to accommodate repeated/missing presentations.
This is a visual pose correspondence, not proof that an XFB ordinal represents
one simulation update. Static holds also make some correspondences ambiguous.
`comparison.json` preserves input hashes and every matched pair;
`alignment.csv` contains per-update regional error. Keep the original sidecars,
native evidence and complete input sequences beside these outputs.

Record authored file hashes when exporting, particularly when the source has
uncommitted changes. The optional `--authored-source-snapshot` accepts that saved
JSON object; its `sidecars` list must identify the final sidecar's filename and
its `files` list should contain each renderer/controller path and SHA-256. The
report retains the snapshot and its hash, plus the analysis tool's own hash.
Do not hash a newer checkout and associate it retroactively with an older export.
When no matching snapshot survives, the report explicitly records its absence.

## Original captured background music

Use a fresh quiet recording with the pointer away from controls. Locate the
BGM's first DSP sample and preserve a complete uncontaminated loop. The exporter
requires quiet-idle-boundary.json with the reviewed audioSizes boundary, one
DSP dump, the matching original sound archive and an explicit onset:

~~~sh
python3 tools/reference/export_captured_bgm.py /path/to/quiet-capture \
  --start-sample MEASURED_SAMPLE --sound-archive /path/to/IplSound.brsar --activate
~~~

Do not copy an onset or quiet boundary from another session. The exporter
validates the supported original sequence and records source/output hashes and
sample rate. Activated PCM remains local and is checksum-checked during later
asset export. If a retained activated WAV has lost its original recording, it
can still play but cannot be re-exported or independently compared from that
missing source.

The alternate synthesized background is available explicitly:

~~~sh
python3 tools/assets/export_audio.py --background-source builtin
python3 tools/assets/export.py
~~~

This is an approximation, not an original native recording. Ordinary audio
export prefers a valid activated recording; --background-source capture requires
one. Preserve the distinction in reports.

## Complete menu interaction capture

Open `/menu-inspect.html` on the local development server and finish Health and
Safety. Pause freezes simulation and the inspector clock/date. Choose a capture
length, arm **Record next pointer action**, then click an ordinary menu control.
The first PNG contains that click at update zero; subsequent PNGs each advance
one 60 Hz update regardless of browser rendering throughput. Choose the explicit
pointer-press trigger for a grab sequence. Audio runs on its ordinary audio clock
and these fixed-step exports must not be used to infer synchronized audio timing.
Press **F8** to save a single current frame while retaining the pointer's hover
position; clicking the toolbar would first move the pointer away from that control.

The page uses the actual application controllers and renderer. It writes PNGs and
sidecars through the existing local capture endpoint, including source WAD/resource
hashes, display geometry, controller state, input trigger and simulation phase.
The final sidecar contains a complete sequence manifest accepted by
`compare_sequence.py`. Save an authored-source hash snapshot before loading the
page, associate it with the completed sidecar, and retain it alongside comparisons.
Reload after source changes. Ordinary `/` never enables the inspection clock or
serializes capture metadata. Health and HOME reboot use the same inspection callback, so their early render
paths remain in the exported sequence. Up to 600 updates may be recorded.
