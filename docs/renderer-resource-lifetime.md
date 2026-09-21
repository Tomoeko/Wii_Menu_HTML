# Renderer resource lifetime

The renderer caches loaded textures by asset URL and shares each in-flight
decode/upload across concurrent layout loads. Static texture lists, BRLAN
texture-pattern resources and aliased font sheets use the same cache. The
previous cache contained only completed uploads, so startup's parallel layout
loads could each allocate the same texture and overwrite its stored handle.
The discarded handles were not released.

A failed shared decode rejects every waiting caller. A failed upload releases
its texture. Both paths remove the pending entry so a later explicit load can
retry. Repeated successful loads create no new image or texture objects.
`renderer-load.test.js` covers these observable lifecycle rules.

## Measured local resource counts

On 2026-09-21 an explicit diagnostic page was operated in native Chrome through
cua_repl. It loaded 117 prepared menu layouts, both HCGE layouts and the HCGE
font sheet layout concurrently: 120 layouts with 778 distinct texture URLs.
The diagnostic retained the previous loader solely as a comparison implementation.

| Resource | Previous loader | Shared in-flight loader |
| --- | ---: | ---: |
| Image decode requests | 3,973 | 778 |
| Texture allocations, including the white texture | 3,974 | 779 |
| Texture uploads, including the white texture | 3,974 | 779 |
| Vertex buffers | 1 | 1 |

After warming both requested HCGE text phases, 120 frames containing twelve
icons each created zero additional images, textures, uploads, shader programs
or vertex buffers. WebGL reported no error. CPU draw submission measured a
6.7 ms median and 9.6 ms 95th percentile in that run. These figures do not
measure end-to-end hover latency, GPU completion or TV presentation. The
observed cold-load durations also include browser cache and execution-order
effects and are not a controlled speedup estimate.

The ignored fixture and observed report are
`artifacts/renderer-resource-audit/index.html` and `observed-result.json`.
Resource reuse is established for this workload; full menu input latency,
shader compilation on previously unseen scenes and native visual fidelity
remain separate acceptance checks.

## Optional graphics enhancements

The host Graphics page edits the `graphics` section of `config.json`. The public
default keeps the 640×456 logical framebuffer and uses 2×2 SSAA with gamma
conversion. Logical projection, pointer coordinates, original texture and BRFNT
resources, animation curves and draw order do not depend on these enhancement
settings.

The final presentation canvas follows the CSS surface multiplied by the browser
device-pixel ratio, capped at a 3,840×2,160 pixel budget. The Wii scene remains
at its configured raster, so a 4K display receives a physical-pixel fullscreen
resolve without turning the whole scene into a 4K render target. That resolve
uses Dolphin-style sharp-bilinear sampling for fractional and integer upscales;
it avoids the browser's second bitmap-scale blur while keeping the cost to one
fullscreen pass.

| Option | Values | Effect |
| --- | --- | --- |
| `resolutionScale` | Integer 1–4 | Multiplies the output raster in both dimensions. |
| `antiAliasing` | `none`, `post-process`, `ssaa-4x`, `ssaa-9x` | Chooses no filter, a legacy 1× edge filter, or a 2×2/3×3 supersample resolve. |
| `colorCorrection` | `none`, `gamma`, `ntsc-m` | Keeps source values, converts assumed source gamma to sRGB, or also converts SMPTE-C primaries to BT.709. |
| `sourceGamma` | Number 1–3; default 2.35 | Source gamma assumption used when correction is enabled. |

The default `ssaa-4x` mode renders every pane, glyph and texture sample at two
times each output dimension and averages the four corresponding samples. This is
the same coverage-preserving class of resolve Dolphin uses for SSAA; it smooths
geometry and text without applying a broad edge blur over finished pixels. The
`ssaa-9x` mode uses three times each dimension. Both increase pixel work fourfold
or ninefold before any resolution scale and require more target memory. The
legacy `post-process` value remains accepted for old configuration files and
retains a 1× raster; it is not the public default because a generic neighboring
pixel filter can soften small text and artwork. None of these modes can recover
detail absent from an original bitmap.

The general single-pass edge-filter tradeoff is described in NVIDIA's
[FXAA white paper](https://developer.download.nvidia.com/assets/gamedev/files/sdk/11/FXAA_WhitePaper.pdf).
Dolphin separately offers increased internal resolution, hardware MSAA/SSAA,
gamma-correct output resampling and color correction; see its
[enhancement guide](https://dolphin-emu.org/docs/guides/performance-guide/),
[output-resampling report](https://dolphin-emu.org/blog/2023/11/25/dolphin-progress-report-august-september-and-october-2023/)
and [graphics defaults](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/Core/Config/GraphicsSettings.cpp).
Those references establish the method, not equivalent browser or hardware output:
Dolphin's high-quality path is SSAA/MSAA plus a selectable output resampler, not
a generic FXAA-like blur. This project's GLSL is independently authored; its
SSAA resolve and color transform use standard transfer-function and
primary-matrix math. The 2.35 gamma default is a conventional assumption, not a
calibration result.

`render-presentation.js` composites the Settings canvas beneath the premultiplied
menu, HOME and pointer image before applying one color conversion. The sharp
upscale path performs the same source-gamma decode as the native SSAA resolve
before encoding sRGB; this keeps high-DPI output from washing out already
encoded artwork. Offscreen scene captures retain source colors. Supersample
color correction averages decoded samples before encoding sRGB; the legacy edge
filter is retained only for old configurations. HDR output and Dolphin's
individual resampling kernels are not implemented. Settings uses its original
608×456 logical layout
at the total chosen raster scale, rerasterizing outline fonts while preserving
RGB565 quantization. Original image pixels remain original image pixels.

Presentation targets are allocated during startup, checked against GPU texture
and viewport limits, and reused until dimensions change. Unsupported allocation
reports an error rather than silently lowering the requested quality. Settings
uploads only when its raster revision changes and uses existing texture storage
when dimensions are unchanged. Enhanced Settings raster caches are bounded to
64 MiB and eight entries. Native-size Settings keeps its verified fast-image
hover path; higher-resolution Settings uses complete raster snapshots because
scaled replacement pixels have not established that same equivalence.

Stable HOME grid and preview frames also retain one active RGBA8 framebuffer
snapshot for the underlay. The foreground, pointer, notices and presentation
resolve still run each frame. A scene-key, resize, exit or context-loss boundary
releases it; a 16 MiB budget makes larger supersample targets fall back to the
ordinary draw. Native 2×2 SSAA uses 1,280×912 and consumes 4,669,440 bytes in
the observed browser capture. This is a lifecycle optimization, not a claim of
native pixel or device-performance equivalence.

## Draw submission and diagnostics

Render callbacks are paced to 60 frames per second. A rolling median of observed
refresh intervals selects the callback nearest each fixed 60 Hz deadline. This
avoids phase-dependent short/long frame pairs on high-refresh displays while
retaining elapsed-time animation and avoiding catch-up draws after a pause.
Tests cover refresh-rate changes, callback jitter, missed refreshes and suspension.
Explicit inspector measurements collect callback decisions as well as accepted
frame intervals, so an average of 60 fps does not conceal uneven pacing.

Quad submission uses one fixed vertex buffer and reusable vertex, UV and color
arrays. A compact material signature checks shader-affecting values before
generating GLSL. Per-program uniforms compare their actual Float32 contents,
so mutable animation colors and projection changes invalidate correctly.
Per-unit WebGL samplers retain independent wrap modes even when two slots refer
to the same texture. Repeated state is cached without batching or reordering
draws; clear, capture, presentation and direct resource uploads invalidate the
relevant bindings.

`renderer.getGraphicsStatus()` exposes effective dimensions, shader and draw
submission counts, sampler count, presentation allocation and Settings upload
counts. Normal rendering does not issue synchronous pixel readbacks or GPU timing
queries. The explicit private GPU diagnostic tests native byte preservation,
both supersample resolves, gamma and primary transforms, Settings orientation
and premultiplied composition, steady-state resource reuse, and the legacy edge-filter path.
Its benchmark reports CPU submission separately from asynchronous GPU elapsed
queries, or explicitly reports the GPU extension as unavailable. Native captures,
cross-device performance and calibrated display equivalence remain separate
acceptance work.

### Final buffer and blend-state check

Buffer and blend-state caching preserves every quad and vertex upload while
avoiding unchanged WebGL calls. The 472-quad regression submits each repeated
buffer bind, blend toggle and blend-function call once after invalidation.
Mutable factors, disabled blending, capture failure and presentation handoffs
retain isolated state. Normal menu contexts may discard the default drawing
buffer; Settings/inspectors retain theirs and channel captures own an FBO.

The final seven GPU correctness checks pass. A later warmed populated-grid
comparison measured 7.687 ms mean CPU without this last cache and 7.617 ms with
it, with p95 8.1/8.0 ms over 300 frames each. That small difference is within
run variability. Earlier renderer improvements measured 9.421 to 6.811 ms in a
separate same-host run; this is not a fixed cost for every scene or device.
No additional percentage gain is attributed to the final state cache.
