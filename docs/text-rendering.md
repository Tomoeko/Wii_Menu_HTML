# Bitmap-font coverage and native framebuffer evidence

The default I4/I8 font path now retains the original vertex RGB and applies
texture coverage only to alpha. This corrects the dark, broken-looking edges
observed in the Wii + Internet / Get Connected channel's “Get new software”
text. It does not establish 1:1 text rendering: the comparison captures below
predate the native framebuffer correction and are not aligned native/browser
animation measurements.

## Verified USA 4.3 executable behavior

The analysis concerns the supplied USA 4.3 WAD, SHA-256
`bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.
Its verified System Menu executable SHA-256 is
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.

The original `CharWriter::SetupGX` entry at `0x81516E34` checks the default
color mapping: black `0x00000000`, white `0xFFFFFFFF`. For texture formats
0 and 1, I4 and I8, it selects these original TEV inputs:

| Instruction address | Called function                 | Arguments           | Result                                                  |
| ------------------- | ------------------------------- | ------------------- | ------------------------------------------------------- |
| `0x81517070`        | `GXSetTevColorIn`, `0x81546E2C` | `0, 15, 15, 15, 10` | Stage 0 RGB uses raster/vertex color.                   |
| `0x81517088`        | `GXSetTevAlphaIn`, `0x81546E6C` | `0, 7, 4, 5, 7`     | Stage 0 alpha multiplies texture alpha by raster alpha. |

Thus the default path is:

```text
output.rgb = vertex.rgb
output.a   = texture.a × vertex.a
```

Multiplying RGB by glyph coverage before alpha blending applies coverage a
second time to the foreground contribution. For an antialiased edge with
coverage `c`, that incorrectly weights the foreground by `c²` instead of `c`.
The discrepancy is especially visible in light text on a colored background.

## Browser correction and regression coverage

[font.js](../web/src/font.js) marks I4/I8 sheets with `glyphAlphaOnly`, retaining
that flag only for the default black/white mapping. The corresponding branch in
[renderer.js](../web/src/renderer.js) keeps `raster.rgb` and computes alpha as
`raster.a * texture.a`. Intensity-alpha formats and explicit nondefault mappings
retain their existing color-mapping path.

[font-coverage.test.js](../web/tests/font-coverage.test.js) verifies default I4
and I8 handling, explicit default mappings, nondefault mappings and the separate
intensity-alpha formats. These tests protect the material/shader decision. They
do not measure native texture filtering, display scaling or final pixels.

## Retained local comparison artifacts

These files are ignored local evidence, not public source assets:

| Artifact                                                                                                                                     | Recorded state                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Before](../artifacts/browser-captures/1789690063049-0f906efb.png) and [metadata](../artifacts/browser-captures/1789690063049-0f906efb.json) | Channel `0001000148434745`, icon frame 600, 832×468 output, 832×456 logical projection, 16:9.                     |
| [After](../artifacts/browser-captures/1789690177217-2117c4a5.png) and [metadata](../artifacts/browser-captures/1789690177217-2117c4a5.json)  | Same channel, icon frame and output geometry after the coverage correction.                                       |
| [Native frame 5600](../artifacts/captures/roadmap-16x9/Frames/framedump_5600.png)                                                            | Original purple “Get new software” phase from the fresh USA 4.3, 16:9 Dolphin recording; presented image 836×456. |
| [Comparison sheet](../artifacts/text-quality/coverage-comparison.png)                                                                        | Enlarged before/after crops alongside the native text phase for visual inspection.                                |

The native [capture metadata](../artifacts/captures/roadmap-16x9/capture-session.json)
records the WAD hash, emulator executable hash, Metal backend and raw presented-XFB
capture mode. Frame 5600 is a capture ordinal, not a browser animation frame or a
wall-clock timestamp. The comparison sheet shows the removal of the doubled
coverage effect, but its crops have different native/browser geometry and do
not supply a pixel-error score or prove matched animation phase.

## Framebuffer correction and remaining acceptance

[display.js](../web/src/display.js) now defines the original 640×456 framebuffer
separately from the 832×456 widescreen projection and final TV presentation.
That changes the sampling grid compared with the earlier direct 832×468 browser
captures. Their before/after comparison isolates the coverage change under the
older browser setup; it cannot measure the current final renderer against native
output.

Re-capture the corrected browser at the native framebuffer geometry, align the
channel animation phase, and apply the same presentation scaling before making
new pixel comparisons. Validate original glyph selection, font size, filtering,
material mapping and subpixel placement in both the purple and later icon
phases. Repeat in 4:3 separately. The coverage correction is supported by the
executable and focused tests; final text equivalence remains open.

## Get Connected glyph and filtering audit

The 2026-09-21 audit followed HCGE's original `icon.brlyt` font index to
`wbf1.brfna`, supplied by the shared-font archive. Its SHA-256 is
`cf0e4f41fd53bd9b68b4a0691795060b3ea2120d8bf60eb825a718cb0611b596`.
The prepared face has 32-by-38 design metrics, ascent 31, baseline 30, line feed
38 and I4 sheets. Every character in “Get new software” and “Play with friends
near and far” has a source glyph; neither phrase uses the default glyph.
Their material mapping is the default black/white pair with white text colors,
so the verified alpha-only coverage path applies.

The original `arc/icon.cs.lz7` script contains those exact English strings and
line breaks. Its decompressed SHA-256 is
`a648fd0638b5ed65b057bb702a87f49fd3709c1fef643f4e9ffe41c6b1ea9b9d`;
the supplied script content hash is
`6809d282c82f63b0b1f86ad2c0b3b263846854309aba047a5d0971472521ddf6`.
The standalone inspector now preserves its all-zero, empty method-name entry
instead of rejecting the script as a table overlap. This validates table
contents, not bytecode execution. The browser's existing 20-by-20 purple and
18-by-20 orange font-size choices still require a separately verified script
call trace and aligned capture comparison.

Native `CharWriter` initializes the two filter fields to 1 at `0x81516DC4` and
`0x81516DC8`. `PrintGlyph` reads those same fields at `0x815182A8` and
`0x815182B4`, passing them to `GXInitTexObjLOD` at `0x815182C4`. This establishes
the default linear minification and magnification settings. All six inspected
HCGE icon/banner TPLs also specify linear min/mag filtering, zero LOD bias and
only level zero. No nearest-neighbor or extra smoothing change was justified.
This does not establish GX/WebGL sampler rounding or final presentation parity.

Ignored audit artifacts are under `artifacts/renderer-resource-audit/`:
`hcge-glyph-metadata.json`, `get-connected-texture-state.json` and
`hcge-icon-script.json`. They record source provenance and the evaluated browser
line widths without distributing original resources. Matched 640-by-456 native
and browser captures, at the same animation phase and presentation scale,
remain the acceptance requirement.
