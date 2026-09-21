# Pointer ownership and hotspot evidence

`menu-pointer.js` tracks the physical pointer independently from scene actions.
The previous move handler returned while a HOME restart was active, leaving the
next grid frame at a stale position. Tracking also began only after asynchronous
asset loading. The tracker now starts before preparation, retains client
coordinates until a display is available, and records pointer enter, move and
press in the capture phase. Scene locks continue to reject actions.

The same coordinates are reprojected when the viewport changes. Capture permits
an active drag to continue outside the display; releasing capture, canceling or
losing window focus hides the pointer appropriately. A later resize cannot
revive a pointer hidden by focus loss. Presses update position even when a DOM
activation has no preceding pointermove.

The normal application's body and screen descendants use an authoritative
`cursor: none !important`, including letterbox margins. The sequence inspector
retains its ordinary host cursor outside the screen. Disabled overlay controls
use `pointer-events: none` so browser-specific suppression of events on
disabled native buttons cannot interrupt pointer tracking during Health or
another transition. The stronger cursor rule prevents a native button cursor
from flashing when a pointer crosses two adjacent transparent hit regions.

## Original P1 resources

The supplied USA 4.3 executable, SHA-256
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`, was inspected
through Binary Ninja. `PointerCoreObject::calc` at `0x813444E8` resolves the
`N_Trans` pane and writes the cursor position after calling `get_cursor_pos` at
`0x813645F4`. The latter applies the projection-width ratio and flips Y. Rotation
is applied to `N_Rot` and `N_SRot`. No extra hand-tip offset is added there.

The original `cursor.ash` P1_Def resource places the 54-by-54 hand at `(8, -20)`
relative to that anchor and the shadow parent at `(3, -3)`. `N_Trans` carries
location-adjust flag `0x04`. Existing renderer behavior correctly retains that
resource geometry in both display aspects. Moving the layout root to the
logical pointer position preserves its anchor; no arbitrary hotspot correction
was introduced. Geometry regressions cover all four edges, the center, fractional
CSS bounds, both aspect ratios and the independent native framebuffer size.

## Validation and remaining limitation

The 2026-09-21 explicit local diagnostic page was operated through native Chrome
using cua_repl. Loading, Health-ready, disabled SeenOut handoff and the grid all
reported the body and screen cursor as `none`, with zero invalid cursor policies
on generated controls. The disabled handoff button reported pointer-events none.
Switching the diagnostic to the inspector body class restored body cursor auto
while keeping the menu screen hidden. A coordinate press at the left screen edge
moved P1 there even without the diagnostic's pointermove listener observing a new
move, exercising the new pointerdown update path.

A small OS-style arrow remained visible in native app screenshots despite the
computed `cursor: none` policy. The native screenshot/cursor-compositing path has
not been distinguished from a browser/OS cursor visibility issue. These checks
therefore establish event ownership, authored hotspot geometry and DOM cursor
policy; they do not establish that intermittent host-compositor flicker is fully
eliminated. The browser implementation for R04 is complete; keep the independent
visible-cursor recording as a Section 7 native/device release gate.
