# Custom channel placement guides

These transparent SVG overlays are original authoring aids for Photoshop,
Illustrator, GIMP and similar tools. Open a guide at its native size, place it
above the artwork while composing, and hide the guide before exporting. The
guide itself must never be included in a channel texture.

The menu's logical layout is 608×456. Layout translations use a centered origin
with positive Y upward. SVG and image pixels use a top-left origin with positive
Y downward, so a pixel at `(x, y)` corresponds to layout coordinates
`(x - 304, 228 - y)` on the logical canvas.

Use the matching display guide when checking a final composition:

| Guide | Canvas | Placement surface |
| --- | ---: | --- |
| `banner-guide-4x3.svg` | 608×456 | 608×339 body above the footer |
| `banner-guide-16x9.svg` | 832×456 | 832×339 body above the footer |
| `icon-guide-4x3.svg` | 608×456 | 128×96 icon slot at `(240, 180)` |
| `icon-guide-16x9.svg` | 832×456 | 170×96 icon slot at `(331, 180)` |

The banner guides include the complete channel preview frame. The red dashed
outline is the native rounded black mask. The cyan lines mark the native edge
mask regions: 64 pixels on each side in 4:3, and 87.578947 pixels on each side
in 16:9. The purple dashed rectangle shows the fitted envelope for the
included 200×100 example GIF. The gray band is the native Wii Menu/Start footer;
it begins at raster Y 339 and is drawn above the banner.

Artwork is fitted inside the marked body without changing its pixel aspect
ratio. A wide or narrow source can therefore leave the channel's background
visible on the sides. Keep every frame of an animated image or video on the
same canvas; do not crop or rewrite the source GIF to compensate for the
preview frame. `placement-reference.json` contains the same measurements for
tools that prefer data over an overlay.

The icon guides show the centered menu slot and do not include the channel
preview frame because icons are rendered in the Home Menu grid.
