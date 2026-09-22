# Authoring custom channels

Custom channels use JSON layouts and animation curves, PNG textures, and optional
PCM WAV sound. The menu renders them through the same pane, material, font and
animation code as imported channel resources. Hover, selection, channel preview,
return, dragging and saved placement use the existing menu controllers. The Start
button remains a local placeholder; packages cannot launch arbitrary programs or
inject JavaScript.

This authoring format creates browser channels. It does not build installable Wii
WADs, convert arbitrary channel programs, or claim native equivalence for artwork
you create. The template artwork and five-note sound are original; its font is resolved from
your own prepared menu resources. The included `sound.wav` is synthesized locally
by `tools/custom-channel-audio.mjs`, with no external recordings or samples.

## Create a channel in your browser

Start the local server and open
[Channel Manager](http://127.0.0.1:5173/channels.html). **Install example channel**
adds a complete sample with an animated icon, banner entrance/loop and original
2.4-second sound. Installing the same example again does not create a duplicate.

For your own channel, enter a name, choose background/accent colors, and select
**Create and install**. Optional PNG, JPEG or GIF files add icon and preview artwork. The sound
selector offers the original sample melody, silence, or your own PCM WAV. A
generated identifier keeps separate creations from replacing one another.

The manager retains an editable source folder at
`.local/custom-channels/<id>/`. Back up that folder to keep your layouts and media.
Its installed resources use the same validated, versioned custom catalog as the
CLI. Reload the Wii Menu after installation, then click the channel to open it.
The manager's **Preview** link also plays both animations and lets you replay the
sound without entering the menu.

To install an existing authored package, select its folder under **Have a channel
folder?** and choose **Import and install**. The folder must contain `channel.json`
at its top level. JSON, PNG, JPEG, GIF, WAV and Markdown files are retained; unsupported file
types are ignored. The manager rejects duplicate identifiers instead of replacing
an existing channel. For an intentional update with the same ID, edit your source
folder and use the CLI `add` command below.

Browser import accepts up to 260 supported files, 2 MiB per JSON/Markdown file,
32 MiB of media in total, and a 56 MiB encoded request. Referenced paths must stay
inside the package and use letters, numbers, dots, dashes or underscores. Invalid
files leave the installed catalog unchanged.

Use **Hide** to remove an installed channel from view and **Show** to restore it.
These controls preserve its files and remembered position. The Disc Channel stays
fixed, and a full menu reports additional channels as awaiting a free slot.
Installing an example that is already hidden preserves that choice; use **Show**
to make it visible again.

## Create, install and remove

The supplied `templates/custom-channel/` is already a complete authored package:
animated icon, banner entrance/loop and a 2.4-second stereo preview sound. After
preparing the menu assets, install it directly with:

```sh
npm run channels -- validate templates/custom-channel
npm run channels -- add templates/custom-channel
npm run channels -- install examples/custom-channels/custom-artwork-qa-da0a7872 \
  examples/custom-channels/custom-studio-channel-9899b686
npm run channels -- overwrite ~/MyChannel /path/to/another-channel
```

To create an independent editable copy instead, run:

```sh
node tools/channels.mjs init ~/MyChannel --id custom-my-channel --title "My Channel"
node tools/channels.mjs validate ~/MyChannel
node tools/channels.mjs install ~/MyChannel
node tools/channels.mjs list
```

The destination of `init` must not already exist. It creates both layouts and
regenerates the original 32 kHz PCM WAV from local oscillator code. Its icon label is shortened to
20 characters when needed; the full manifest title remains available in the
menu hover bubble and banner. Both visible layout labels remain editable. Edit `channel.json`, `icon.json`
and `banner.json`; run `overwrite` to replace that channel's installed version.
`install` rejects an already installed ID.
Keep its identifier unchanged to preserve its current saved slot. Reload the menu
after any install, update or removal. New channels fill available empty slots;
the menu has 48 slots including the fixed Disc Channel. Additional enabled titles
remain installed and are reported as `unplaced`; they do not overwrite a slot.
[Visibility and placement](channel-management.md) describe enable/disable,
re-enabling saved positions, missing assets and shared WAD/custom commands.

```sh
node tools/channels.mjs remove custom-my-channel
# Or remove one or more packages by their authored folders:
node tools/channels.mjs remove ~/MyChannel /path/to/another-channel
```

Removal updates only the custom catalog. It preserves the authored package, WAD
catalog, existing saved arrangement file and generated content versions. The next
menu load reconciles removed identifiers. Generated versions remain available to
already open browser tabs; they can be discarded with other prepared assets when
you deliberately rebuild the entire output directory.

Installed entries live in `web/public/assets/custom-channels.json`; resources live
under `web/public/assets/custom-channels/<id>/<content-hash>/`. Normal WAD prepare,
add and remove commands do not overwrite this separate catalog. Back up your
authoring folders and `.local/channel-layout.json`; after deleting prepared assets,
run `install` for new packages or `overwrite` for existing packages. For isolated
output/tests, commands accept `--assets /path/to/output`.
`list` and visibility commands also accept `--config /path/to/config.json` and
`--layout /path/to/channel-layout.json`. The old `channels:custom` alias remains
available for custom-only commands.

Installation, repair and catalog removal also hold `.local/.prepare-lock`, shared
with WAD/NAND preparation and permanent deletion, so preparation cannot publish
an older asset snapshot over a newly created channel. Isolated commands must
pass the same `--local-dir` as preparation alongside `--assets`; the custom-only
CLI alias accepts both options. A lock owned by another command is never removed
by the custom installer. Preparation owns recovery of its interrupted journal.

Catalog updates use an exclusive lock and atomic rename. If a process is forcibly
terminated and leaves `.custom-channels.lock` in the asset directory, first confirm
no authoring command is running, then remove that empty lock directory and retry.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "custom-my-channel",
  "title": "My Channel",
  "iconLayout": "icon.json",
  "bannerLayout": "banner.json",
  "audio": {
    "src": "sound.wav",
    "loop": false
  }
}
```

The `audio` member is optional. Identifiers start with `custom-` and use lowercase
letters, digits, hyphens and underscores, up to 63 characters in total. `title`
supplies the menu's hover label; the layouts contain their own visible text.
All resource paths are relative to the package directory, including texture paths
inside layouts. Absolute paths, URLs, parent traversal and symlinks escaping that
directory are rejected. Only validated referenced files are copied.

Sound supports mono/stereo integer PCM WAV at 8–192 kHz. Optional `loopStart` and
`loopEnd` are seconds within the file; set `loop: true` to repeat. Sound begins with
the existing channel preview controller and follows its mute/volume/lifetime
behavior. Browser audio still needs the user's initial interaction.

## Layout and aspect ratio

The channel preview is a complete 608×456 or 832×456 raster. Its native
rounded black TV mask is drawn over the banner, and the Wii Menu/Start footer
starts at raster Y 339. In 16:9, the mask's side regions are 87.578947 pixels
wide; in 4:3, the native corner and side tiles are 64 pixels wide. Keep the
full preview frame in mind when composing a banner: an aspect-preserving image
can leave the menu's background visible at either side, as the included example
does. The guides in `examples/assets/custom-channel-guides/` mark the full
frame, mask boundary, side regions, artwork envelope, and footer without
changing the source GIF.

The template uses the readable exported BRLYT schema:

| Field              | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `root`, `children` | Ordered pane tree; later siblings draw over earlier ones               |
| `type`             | `pan1` group, `pic1` rectangle/image, or `txt1` text                   |
| `translation`      | X, Y, Z; centered origin with Y pointing upward                        |
| `rotation`         | X, Y, Z in degrees                                                     |
| `scale`, `size`    | Two-dimensional scale and authored extent                              |
| `alpha`            | Pane opacity, 0–255                                                    |
| `flags`            | Bit 0 visible; bit 1 propagates alpha; bit 2 applies aspect adjustment |
| `origin`           | 0–8 anchor; 4 is centered                                              |
| `material`         | Index in the layout's `materials` array                                |
| `vertexColors`     | RGBA colors in left-top, right-top, left-bottom, right-bottom order    |

Keep the layout at 608×456. The icon is drawn around the channel slot's center,
clipped to 128×96 in 4:3 or 170×96 in 16:9. The template's background fills the
full preview raster while its foreground is fitted without changing its pixel
aspect ratio. Banner artwork fits the 339-pixel body above the native Wii
Menu/Start footer, which begins at raster Y 339; it is centered in that body
and never renders underneath the footer. The rounded frame and side mask are
part of the native channel-title layer, so do not bake a replacement border
into the GIF or image you author.
The original widescreen renderer expands the root horizontally; flag `4` on a
pane compensates its local X scale. The template applies this once to `Content`,
so its children retain their proportions. Do not add it again to every child.

Import-ready Photoshop/GIMP overlays for these surfaces are in
`examples/assets/custom-channel-guides/`. They include 4:3 and 16:9 banner
canvases with the complete rounded frame and side-mask geometry, both icon
slots, centered axes and a machine-readable `placement-reference.json`. Keep
the overlay as a temporary top layer and hide it before exporting. Animated
images and video should retain one fixed canvas; the source GIF is not rewritten
by the installer.

Text uses `font` as an index into `fonts`, `fontSize: [width, height]`, `textPosition`
as a 0–8 alignment (4 centered), `textColors` as top/bottom RGBA, and optional
`charSpace`/`lineSpace`. The template references `wbf1.brfna`; the renderer resolves
prepared shared fonts, with the menu font fallback. Text never becomes HTML.

## Add a PNG

Put `artwork.png` in the authoring directory. Add this texture descriptor, using
the image's actual pixel dimensions:

```json
{
  "name": "Artwork",
  "url": "artwork.png",
  "width": 256,
  "height": 128
}
```

Add a material with a single texture map (`texture` is its index):

```json
{
  "name": "ArtworkMaterial",
  "colors": [
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [255, 255, 255, 255]
  ],
  "textureMaps": [{ "texture": 0, "wrapS": 0, "wrapT": 0 }]
}
```

Point a `pic1` pane's `material` to that material, set all four vertex colors to
white, and give it these texture coordinates:

```json
"texCoords": [[[0, 0], [1, 0], [0, 1], [1, 1]]]
```

The validated authoring subset supports one texture per material, optional texture
SRT transforms, and ordinary vertex/material colors. Full custom TEV programs,
window panes, new font files, native modules and channel scripts are outside this
format. Imported Nintendo channel resources continue to use their existing path.

## Animation

Animations run at the menu's 60-update clock. The icon accepts `icon` (the template
uses a repeating 180-frame animation), `icon_Start`, or `icon_Whole`; if several
exist, the controller chooses the first supported name in that order:
`icon_Start`, `icon`, `icon_Whole`.

The banner plays `banner_Start` once, then `banner_Loop`. If neither startup nor
loop is supplied, `banner` is its repeating clip. Startup duration follows the
original controller's last-frame convention: a nonlooping 31-frame clip reaches
its final frame at update 30. Properties absent from the loop retain startup's
final values. The sample fades/slides `Content` in, then gently rotates `Mark`.

Each animation target names a pane (`type: 0`) or material (`type: 1`). Tracks use
`curveType: 1` for stepped values or `2` for Hermite curves. Hermite slopes are
values **per frame**, not normalized tangents. Key frames must strictly increase.

| Track  | Target indices                                                          |
| ------ | ----------------------------------------------------------------------- |
| `RLPA` | 0–2 translation, 3–5 rotation, 6–7 scale, 8–9 size                      |
| `RLVI` | 0 visibility                                                            |
| `RLVC` | 0–15 vertex RGBA components, 16 pane alpha                              |
| `RLMC` | 0–3 material RGBA, 4–15 register colors, 16–31 constant colors          |
| `RLTS` | 0–1 texture translation, 2 rotation, 3–4 scale                          |
| `RLTP` | 0 texture-pattern index; use step curves and animation `textures` names |

Limits bound accidental resource overload: 128 panes, 16 tree levels, 64 materials,
128 textures, 10,000 keys per layout, 2 MiB per JSON file and 32 MiB of referenced
media. PNG dimensions and WAV sample metadata are checked during installation.

Use the channel inspector to play/scrub the exact same layouts:

```text
http://127.0.0.1:5173/inspect.html?channel=custom-my-channel&kind=icon
http://127.0.0.1:5173/inspect.html?channel=custom-my-channel&kind=banner
```

The tests exercise template animation through the production controller, optional
PNG/WAV installation, updates/removal without disturbing native imports, path
containment, invalid input preserving the current catalog, and saved-slot merging.
