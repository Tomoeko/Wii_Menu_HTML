# Local Wii resource preparation

Run from `Wii_Menu_HTML-Final/`. No console keys, original menu resources, channel applications, or generated graphics are included in the public source.

```sh
npm run prepare -- --wad /path/to/menu.wad
npm start
```

Retail ticket key indices 0 and 1 are supported by the local importer. Public constants are documented in `common_keys.py`; their XOR representation is cosmetic. Use `--common-key-file` for an explicit 16-byte or hexadecimal override and `--common-key-index` to enforce its ticket index. Keys never enter generated browser assets. AES-CBC uses Node's built-in crypto through private pipes, with no pip dependency; every content must match its TMD SHA-1 before import. This checks content integrity, not signature authenticity.

`prepare.py` finds the menu archive and font contents by their members, without relying on a particular content filename. Validated title contents and import configuration stay in ignored `.local/`; generated browser resources stay in ignored `web/public/assets/`. `--local-dir` and `--output` support isolated verification. A no-argument `npm run prepare` prints instructions and makes no asset changes, so npm's install lifecycle works without private inputs. Rebuild existing imports with `npm run assets:all` or `npm run prepare -- --rebuild`.

The supplied USA 4.3 System Menu WAD contains the menu layouts, settings HTML, bitmap and outline fonts, and menu sound archive. **Separate channels are not in that WAD.** With no additional inputs the catalog contains only Disc. Add repeatable `--channel-wad /path/to/channel.wad` flags or repeatable `--nand PATH` inputs to the preparation command. NAND inputs accept an extracted `title/` directory, raw BootMii dump, or folder containing one dump. Each raw dump uses its sibling `keys.bin` or embedded footer; `--nand-keys PATH` overrides the key file for one input. See [NAND import](../../docs/nand-import.md) for extraction-only usage, authentication and format limits.

```sh
npm run channels -- add --wad /path/to/channel.wad
npm run channels -- install /path/to/custom-channel-one /path/to/custom-channel-two
npm run channels -- list
npm run channels -- remove 0001000154455354 custom-my-channel
```

Removal changes the local catalog and remembers exclusions on later NAND imports; it does not delete the supplied WAD or NAND content. Reimporting the same channel WAD enables it again. Channel placement follows checksum-validated `iplsave.bin` when supplied; `savedLayout` retains 48 original slots and gaps. Additional preferred channels from WADs or NANDs are appended to the available default order. Existing NAND title IDs retain their original imported content unless a NAND update explicitly selects `--replace-channel ID` or `--nand-policy replace`; `--keep-channel ID` can override a bulk replacement or skip a new title. Explicit WAD imports can also replace a title. New NAND imports copy selected banner resources into managed private storage, so rebuilds do not depend on the extraction scratch directory. Browser rearrangement configuration is separate and is not overwritten by the exporter.

NAND channels retain priority over custom channels. If custom channels were
installed before a NAND import, newly introduced NAND titles take their exact
saved-layout slots first and custom channels are placed into the remaining slots.

Menu effects and channel sounds export automatically. The built-in Python converter reads original BNS DSP ADPCM and uncompressed RIFF/WAVE without an external media decoder. It preserves sample rate, channel order, sample count, and source loop markers; it does not bake repeated loops or fades into the WAV. See [the channel audio decoder](../../docs/channel-audio.md) for supported formats, validation, and comparison evidence. The drag sound retains its original looping waveform; its AX envelope is not synthesized.

BGM is a sequence plus instrument bank, not a standalone sound file. Fresh
preparation renders it automatically with Python and the application's Node.js
runtime, using only built-in libraries. The supplied USA 4.3 executable provides
its original envelope, volume and pan lookup
tables locally. No `mrst`, FluidSynth or vgmstream executable is required.
`--background-source auto` preserves an explicitly activated native recording,
otherwise reuses validated built-in PCM or regenerates it. `builtin` explicitly
regenerates the built-in mix; `capture` requires an activated recording.
`--background` remains accepted for compatibility. `WII_MENU_NODE` may point to
an explicit Node executable if it is absent from `PATH`.

The exporter also retains `WIPL_SE_WII_START` as `backgroundIntro`. The browser
starts that original one-shot wave alongside the first BGM sequence pass, then
loops the prepared or realtime sequence at its verified sequence boundary.
An activated native DSP capture records the mixed startup wave already, so its
manifest is marked accordingly and the browser does not double-play the cue.

`audio.backgroundMode` in `config.json` selects `"prepared"` (the default) or
`"realtime"`. Live playback loads the original sequence and PCM instruments
into an AudioWorklet; it retains its clock and voices across preview/HOME pauses.
Offline and live paths share `web/src/sequence-engine.js`. Sequenced effects use
the same engine, including original ADSR overrides, AuxA sends and ReverbHi.
Only trailing PCM zeros are removed after the rendered decay. Native DSP mix
ramps, interpolation and auxiliary bus latency are still under comparison.
See [audio evidence](../../docs/audio-cues.md).

The optional [shared Aux bus staging tool](../../docs/audio-aux-bus-plan.md#staging-and-compatibility)
exports separate dry/send resources for validation in an empty output directory.
It preserves the normal WAV catalog and renderer version 10, and is not invoked
by preparation or selected by browser playback.

Individual exporters require explicit `--source` or `--nand` arguments. The sound
exporter can reuse `.local/IplSound.brsar` produced by preparation. For a different
local preparation directory, pass `--native-content` with the extracted System
Menu content directory or executable. No tool searches neighboring projects or
automatically builds a dependency.

The visual exporter covers all 32 supplied common layout packages, including health, settings, Message Board, calendar, letters, memory management, and keyboard graphics. It merges the selected `--language` overlay when present. The supplied menu has 116 layouts, seven 458-message BMG tables, and a 758-file Opera settings archive. [The resource inventory](ASSET_INVENTORY.md) distinguishes exported assets from implemented browser functionality.

The browser ports the verified startup/idle schedules of these local channels instead of treating every Rso track as an independent loop. [CHANNEL_SCRIPTS.md](CHANNEL_SCRIPTS.md) records the bytecode/native references, no-save-data assumptions, sound provenance and the `npm run trace:channels` numeric trace command. Numeric traces are not rendered native captures.

Tests use synthetic resources, including encrypted WAD fixtures with a made-up test key: `npm run test:assets`. The output manifest identifies the supplied WAD and resource archive by SHA-256.

## Output contract, schema version 1

All asset URLs inside visual JSON are relative to `/assets/`.

- `manifest.json`: `layouts` maps original BRLYT stems to `{url, package, name}`; duplicate names are qualified with the package. `packages` lists layout IDs, animation names, and texture counts. `fonts` maps original BRFNT names to `{url}`. `audio` is populated from the optional audio export.
- Layout JSON: `width`, `height`, `originType`, `textures`, `resourceTextures`, `fonts`, `materials`, `groups`, `root`, and `animations`. `source` retains the original archive/member path. Selected-language HOME-menu resources are merged with the common package.
- Panes: `name`, original four-character `type`, raw `flags`, `origin`, `alpha`, `translation:[x,y,z]`, `rotation:[x,y,z]` (degrees), `scale:[x,y]`, `size:[w,h]`, and `children`. Picture/window panes add `material`, `vertexColors` and `texCoords`, ordered top-left, top-right, bottom-left, bottom-right. Text panes retain text, font index, font size, spacing, colors and alignment. Window panes additionally retain original frame material/flip/inflation records.
- `resourceTextures` maps every texture filename in the package to its descriptor, including textures referenced only by BRLAN texture-pattern tracks. `textures` preserves the original BRLYT table order and its material indices.
- Texture descriptors: `{name,url,width,height,format}`. A missing local texture becomes `{name,missing:true}`; it is never silently replaced in the export. TPL image 0 is the layout texture, and additional image entries are also exported with numeric suffixes.
- Materials: `colors` is the three original signed GX color registers in register order, `konstColors` the four RGBA constant registers, `textureMaps:[{texture,wrapS,wrapT}]`, `textureSRTs:[{translate,rotation,scale}]`, and `texCoordGens:[{type,source,matrix}]`. TEV stages retain their exact 16 resource bytes; optional channel control, material color, swap, indirect, alpha-compare and blend records are retained.
- Animations: `frames`, `loop`, `textures`, `targets:[{name,type,tracks}]`. Type 0 targets a pane; type 1 a material. A track is `{kind,id,target,curveType,keys}`. Hermite keys are `{frame,value,slope}`; step keys are `{frame,value}`. `target` is the source property selector, distinct from `id` (texture unit/element index). Frame numbers and slopes remain unchanged.
- Fonts: `characters` maps Unicode codepoint strings to glyph indices; `glyphs` maps glyph indices to `{sheet,x,y,width,height,left,advance}`. Sheet descriptors contain `url`, dimensions and format. Glyph coordinates include the one-pixel cell inset used by the original NW4R renderer. Font `height`, `width`, `ascent`, `baseline`, `lineFeed`, `defaultGlyph` and encoding are retained.
- `outlineFonts`: browser TTF faces split from the original TTC without changing outline/hint/metric tables or valid character mappings. Raw split faces are retained under `fonts/raw/`. The supplied font's invalid format-4 U+FFFF sentinel maps to glyph 65535; the derived browser face maps that noncharacter to missing glyph 0 so OpenType Sanitizer accepts it. `browserRepairs` and both raw/derived hashes record the change. `fonts/outline-fonts.css` includes Opera's Latin/Japanese family names and original FOT aliases, including the source CSS's misdecoded Shift-JIS spellings.
- `settings.json` and `manifest.settings`: original Opera settings entry points and source hashes. HTML in `settings/` inserts `/src/settings-bridge.js` before the original scripts; all remaining bytes are unchanged. `settings-raw/` preserves the decompressed original HTML. Other original images/CSS/JavaScript are exported unchanged. Runtime sandboxing and the hardware bridge belong to the browser application.
- `messages`: localized BMG JSON and original binary URLs. JSON contains `messages` by original numeric index plus `records` with text segments, opaque control packets, and attributes.

## Reference and fidelity limits

The exporter reads original WAD binary resources. BRLAN step values are unsigned 16-bit integers and animated property IDs occupy target byte 1. Synthetic fixtures check offsets, widths and malformed input. Decoding tests alone do not establish that every renderer interpretation matches native execution.

GX texture conversion covers I4, I8, IA4, IA8, RGB565, RGB5A3, RGBA8, CI4, CI8, CI14X2 and CMPR. Tiled padding is consumed even for clipped edge pixels. Bit expansion, CMPR interpolation and transparent CMPR RGB have explicit conversion tests; native visual equivalence remains a separate check. PNGs preserve raw texture color/alpha; material TEV colors and animation must still be applied by the browser renderer.

Exported resources provide original layout data, not proof that the browser output is pixel-identical. Renderer precision, texture filtering, TEV behavior, application-side transforms, state timing, font positioning, sound synthesis and display scaling require separate capture comparisons. Unsupported input raises a descriptive error; this is a local asset conversion pipeline, not a general-purpose archive-validation library.
