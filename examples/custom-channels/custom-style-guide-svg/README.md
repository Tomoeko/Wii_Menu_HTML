# SVG style-guide channel

This example deliberately uses the channel placement guides as its artwork. The 16:9 SVG is the visible texture in both layouts, so the rounded preview mask, side regions, footer, axes, and artwork slot remain visible in the channel preview. The matching 4:3 SVG is included as the alternate texture for authoring at that aspect.

The SVG files are copied into this package so it can be validated and installed without reaching outside the channel folder. They are static local artwork; no scripts, external resources, or generated raster copies are used.

Validate or install it from the repository root:

```sh
npm run channels -- validate examples/custom-channels/custom-style-guide-svg
npm run channels -- install examples/custom-channels/custom-style-guide-svg
```
