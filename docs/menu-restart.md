# Returning from HOME to a fresh Wii Menu

The supplied USA 4.3 executable does more than fade HOME away. The browser now
preserves its separate loading display before resetting the first channel page,
channel animation clocks, background music, and the initial **Wii Menu** clock
caption. It does not show the health/safety screen again.

## Original evidence

`HomeButtonMenu::calc` at `0x81347F98` requests the reset handler. Its update
function at `0x81356904` eventually invokes `OSRebootSystem` at `0x8138053C`.
After reboot, `BackMenu::create` at `0x8138EAC4` constructs a layout from an
embedded U8 archive at `0x816487E0`. Its original resources are:

- `arc/blyt/my_BackToWiiMenu.brlyt`
- `arc/anim/my_BackToWiiMenu.brlan`
- `arc/timg/IplTopMask4x3.tpl`
- `arc/timg/my_WiiLogoWait.tpl`

The archive is 10,016 bytes, with SHA-256
`597623cfc2f18c08ca725cfb1a70f17c166931c9515e49db4e87f16bc2512497`.
The executable SHA-256 is
`47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43`.
Preparation discovers those member names in validated executable sections;
runtime addresses and executable offsets are derived from the supplied DOL,
not assumed for other versions. Generated metadata records both hashes and the
derived offsets. No extracted resource or executable data is included in source.

The BRLAN contains a 1,000-frame repeating animation. Twelve rounded channel
panes have independent, zero-slope Hermite alpha curves: their maximum alpha is
120, with staggered peaks and disappearance. The last pulse ends at frame 142.
Their placement, Wii logos, source materials and widescreen pane adjustments
come directly from the layout. `BackMenu::calcCommon` at `0x8138EB70` advances
the layout each update. The creation path also performs its first calculation.

`BackMenu::calcFadein` at `0x8138EB78` waits for the global fader. The normal
state at `0x8138EBBC` waits for four system readiness flags. The outgoing state
starts the global fade at `0x8138EC28`; `0x8138EC44` then waits for additional
service readiness and reserves scene 4. This creates two distinct black-screen
boundaries, not one continuous fade from HOME to the grid.

## Browser service boundary and measured fixture

`menu-restart.js` draws the original BackMenu during its incoming fade, loading
wait and outgoing fade. It holds black before initializing the new grid and
revealing it. The shared integer fader preserves its 20 opacity steps and
separate terminal state updates. Input and hidden scenes remain suspended
through the sequence; old menu audio stops before loading and new music starts
at the grid handoff.

The render host resolves HOME's completion callback before selecting the scene
to draw. A completion within a display tick transfers only its unused update
time to BackMenu. The completed HOME layout is hidden and its dialog removed,
preventing an intermediate frame of unfaded bars or confirmation text. Tests
exercise single-update, fractional and delayed display ticks at this boundary.

The current service waits are explicitly local fixtures in `config.json`:

| Setting                             | Default | Meaning                                                                                                                 |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `startup.restartServiceReadyFrames` | 94      | Earliest outgoing fade, measured from loading-display initialization. An unresolved resource promise extends this wait. |
| `startup.restartBlackFrames`        | 43      | Black service wait after the loading display fades out, before grid creation.                                           |

These are 60 Hz controller updates, not native firmware constants. The native
states wait for asynchronous services; storage, channels and hardware change
their duration. The browser reuses prepared resources and does not emulate an
IOS reboot or NAND loading throughput. Failed resource readiness retains the
loading state and reports an error rather than revealing incomplete content.

The defaults were fitted to the fresh 16:9 `address-settings-16x9` capture,
presented images 47531–48057. Sampling twelve interior channel areas over
47531–47649 and fitting the actual BRLAN curves plus source faders gives an
animation-zero alignment at image 47532 and outgoing-fade-zero alignment at
47626: 94 animation updates apart. Mean squared grayscale error is about
0.104 on the 0–255 scale. This phase fit supports the interval independently
of assuming every captured image is an update. Integer raster quantization and
state handoff retain approximately one update of alignment uncertainty.

The black interval ends near image 47692 and the grid becomes fully visible
afterward. Channel-specific native asynchronous availability is not reproduced
by a fixed per-channel delay: browser modules restart from their original
animation programs using prepared assets. Full rendered-frame comparisons,
including module availability and audio alignment, remain acceptance work.

Tests cover loading/fade/black/grid ownership, delayed and rejected readiness,
fractional update accumulation, input-stage boundaries, soundtrack restart,
and extraction from synthetic relocated executable sections.
