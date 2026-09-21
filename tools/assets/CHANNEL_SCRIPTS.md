# Original channel resources and scheduling model

[The browser scheduler](../../web/src/channel-animation.js) implements bounded
startup/idle branches for the inspected original channel resources. It is not a
general RCHE virtual machine or channel executable runtime. The current fixture
uses no saved photos, downloaded news/weather/recommendations or network
configuration. Banner selection starts its own clock and decoded sound.bin;
icon clocks remain independent.

The layouts include animations that are inactive in these branches. Playing
every Rso clip together or selecting an arbitrary frame produces a different
image. The browser binds a numbered clip to the matching Rso group when that
group exists, retains independent controller state and distinguishes the first
pass from later loops. These are implemented schedule rules that require
matching original recordings for acceptance.

## Inspect an explicit original input

~~~sh
python3 tools/assets/inspect_chans.py /path/to/content.app --json
python3 tools/assets/inspect_chans.py /path/to/content.app --member arc/icon.cs.lz7 --instructions
npm run trace:channels
~~~

The inspector is standalone and read-only. It accepts decoded RCHE, a supported
Nintendo LZ77 envelope, or a U8 archive with a script member. Multiple members
require an exact --member path. It validates ranges, name/string encoding,
function references, archive entries and compression references; it never
executes bytecode or native instructions.

Default output preserves original methods, symbols, UTF-16 strings, function
records, raw header/bytecode and hashes. --instructions adds **numeric OP_XX
labels using a provisional width profile**. Those groupings are an inspection
aid, not verified instruction semantics. The profile does not establish branch,
load/store, call or arithmetic behavior. No external opcode header or other
project is consulted. Unknown function attribute bytes remain numeric.

Offsets below are retained bytecode inspection locations, not PPC addresses.
Content filenames are identifiers within a particular supplied title/version,
not universal evidence for every file with that name. Reproduce a finding only
after verifying the relevant input hash and resource tables.

## Retained schedule observations and browser choices

This table records the model implemented from earlier original resource/script
inspection. Values remain useful for targeted audits, but original-versus-
browser loop/frame acceptance is open. Except for the separately hashed cases
below, it is not a claim that the new numeric inspector independently proves
every interpreted VM operation.

| Channel | Original title / inspected content IDs | Implemented fixture schedule and recorded locations |
| --- | --- | --- |
| Photo HAYA | 00010002/48415941; icon 0000000e.app, banner 0000000f.app | Default icon Rso0 at 0xfc. Default banner Rso0 at 0xfa, minimum 40 at 0x117: initial 0–1239, subsequent 40–1239; saved-photo Rso1 inactive. |
| Forecast HAFE | 00010002/48414645; 0000000e.app / 0000000f.app | Icon Rso0 starts at recorded location 0x83; no-data Rso1 held at zero and code pane hidden at 0xc4. Native banner findings below are separate. |
| News HAGE | 00010002/48414745; 0000000c.app / 0000000d.app | Icon_Start; no-data Rso1/Rso2 held at zero, send_id cleared. Banner_Start then textT0 for missing save data at setMessage 0x3db. Rso0 starts its initial fade, then holds through a minimum of max−1, recorded at 0x460. |
| Shop HABA | 00010002/48414241; 00000032.app / 00000022.app | Initialization at 0xad2 resets 16 Rso tracks. No-recommendation branch at 0xdd6 uses Rso0 minimum/current 0 and maximum 630; startAnimation at 0x1002 restarts that track. Banner region/language selection begins at 0x39; English font_e appears in the table-driven path at 0x9a/0xa4. Banner_Start then Banner_Loop. |
| Download placeholders HADE/HAJE/HAPE/HATE/HCLE | Representative 00010001/48414445; 00000032.app / 00000033.app | Recorded frame setup 0xc1 uses 470-update cycle: Rso0 min 1 / max 471 / initial 180; Rso1 min 0 / max 470 / initial 530; Rso2 min 0 / max 470 / initial 240; Rso3 speed 1024/290 and max/initial 470×speed. Restart location 0x22d. Banner Rso0 0–40 once; Rso2 initial 0–189 then 40–189. Telop length depends on original text metrics. |
| Get Connected video HCGE | 00010001/48434745; 00000006.app / 00000007.app | No-network icon path at 0x1c3 starts/minimum 1000 and loops through 2084; configured path uses minimum 1. Banner Rso0 runs forward to 330. |
| Mii HACA | Original icon/banner resources, no script in the inspected package | Icon loop; browser treats Banner_Start as a forward intro then switches to Banner_Loop, separately from its authored loop flag. |
| Forecast/News download placeholders HAFA/HAGA | Original resources, no script in the inspected packages | Static icon and banner_start → banner_loop; distinct from HAFE/HAGE. |

The inspected downloadable placeholders are advertisements. Their local icon,
banner and audio do not constitute the full Internet, Everybody Votes,
Check Mii Out, Nintendo or Netflix applications.

The browser controller uses frame-count endpoints for loops and frame-count
minus one for one-shot playback. It preserves a controller endpoint when its
play mode changes and permits the initial frame to precede a later loop
minimum. Tests and traces exercise these choices. Revalidating their complete
native timing remains separate from identifying resource frame counts.

## Hashed Forecast native banner evidence

Read-only inspection of the original decompressed arc/banner.rso.lz7, including
its export and relocation tables, identified the missing-data branch.

- Content SHA-256:
  9936bc5620767db01e0251b63b461b7fcc0b05b043e15cad196e3008adb987eb.
- Decompressed RSO SHA-256:
  ed6bdb6dd93448abf680f3a2dd4e240c162a82aaa4e56cd0463714b5a78a9e2c.
- Section 1 begins at file offset 0xe0. Exported main_func is at 0x230,
  thread_func at 0x2e4, setup_layout at 0x3a8, setup_message_layout at 0x229c.
- Missing configuration/data yields status 1 at 0x314/0x330. Layout setup enables
  all, hides weather and enables textB0. Status1 chooses textT0; statuses 3/2
  choose textT1/textT2.
- main_func calls animation start for indices 0/1 at 0x2bc/0x2c4. Only banner_Rso0
  exists in this package; its 17-frame nonloop resource ends at 16 and binds Rso0.

These are file offsets in the hashed RSO, not System Menu virtual addresses.
No binary bytes were modified. Additional input states require their own audit.

## Shop title initialization

The inspected Shop banner content SHA-256 is
fc59d6f7502562e8aad5b8e13130d20b6378888ea8dc54947fd581343ae9e172.
Its localized title panes begin hidden. Changing animation time alone leaves
the final title absent. The browser enables the selected language branch while
preserving original glyph textures and intro opacity. The exported resource
places the twelve English title pictures at alpha 255 by frame 789, retaining
visibility through the loop.

This is a resource/schedule finding. Earlier native title screenshots and
complete icon atlases were deleted. New aligned native/browser startup and
loop captures are required for a current graphical acceptance result.

## Numeric traces and limits

~~~sh
node tools/trace-channels.mjs --frames 3600
~~~

A shorter run can use --frames 120. Output goes to ignored
artifacts/channel-traces/. The inventory lists original animations/tracks,
scheduled branches, resource duration and implemented controller settings.
Gzip JSONL records each frame's numeric pane/material changes; frame zero
contains complete state and subsequent records are deltas.

These are browser-evaluated numeric poses, not screenshots, original rendered
captures or an independent reference. They help identify schedule/selection
differences and deterministic candidate states. Saved/online content, arbitrary
native programs and per-console random initial phases are outside this fixture.
Text-dependent schedules need original font metrics. GX rasterization, output
color, filtering, sound onset and complete loop acceptance require native
image/audio comparison.

## Original channel audio

export_channel_audio.py reads meta/sound.bin, validates IMD5/compression
wrappers and uses the built-in BNS/WAVE converter to decode one original pass.
It records source hash, PCM sample rate/count, duration and loop markers. The
inspected Shop sound retains its loop markers; other current banner sounds
are one-shot. Repeated loops or fades are not baked into the WAV.

All 13 locally supplied channel sounds (eight distinct BNS payloads) produced
the same interleaved PCM samples and loop metadata as the retained independent
decoder output. [Decoder details and limitations](../../docs/channel-audio.md)
separate this conversion check from native playback acceptance.

channels.json stores each channel.audio descriptor, with channel-audio.json
preserving it across visual export. This original channel audio path is
separate from BRSAR menu effects and optional captured background music.
Decoded PCM still needs synchronized onset/loop/transition comparison.
