# Wii System Settings rendering

The visible Settings page is now a raster texture in the menu's renderer. Its original extracted HTML remains an isolated, offscreen layout and dummy-state engine. It is no longer an iframe stretched across the display.

## Native evidence

The audit used the local USA 4.3 WAD's verified `00000098.app`. Its second DOL data section maps file offset `0x500` to Wii address `0x8132FFE0`. The binary was inspected read-only with Binary Ninja and LLVM; no source binary was patched.

- `Setting::createBrowser` (`0x813F1344`) obtains `System::getProjectionRect4x3` and creates both the browser and surface at **608×456**, independently of the TV aspect ratio.
- `BrowserThread::InitSurface_` (`www_browser.cpp`) allocates the ARGB CPU raster. `BrowserWindow::ExecWwwEvent_` and `UpdateTexture` retain the previous display while a document loads; `TileBlit_` copies the completed raster into the next texture bank.
- `BrowserWindow::convertToRGB565` (`0x8136F2D0`) truncates red/blue to five bits and green to six bits. The browser implementation performs that conversion before uploading the display texture.
- `Setting::prepare` (`0x813F0B4C`) loads `/html/BG_16x9.tpl`. This is a **112×456** RGB565 texture. `Setting::draw` (`0x813F355C`) draws the 608-pixel page centered, with this texture at both widescreen edges. Stretching the HTML from 608 to 832 pixels changed the native geometry.
- `Setting::draw`, particularly `0x813F3BCC–0x813F3D3C`, draws the old raster opaque and the new raster with integer alpha `floor(frame × 255 / 20)`. The counter is capped at 20 in `calcNormal` (`0x813F20AC`). Ordinary page changes therefore use the native 20-update raster crossfade.
- The old RGB565 raster is scanned for nonblack pixels (`0x813F3C48–0x813F3C94`). Opaque side panels are drawn only when those pixels exist. The first page therefore fades its side panels with the page; later page changes preserve their brightness. The first texture fade also overlaps the global scene fade.
- The `wiiTrasition` plugin only queues a direction. The scene consumes that flag after the next page's raster is available. It assigns the old texture to `Tex0` and the new texture to `Tex1`/`Tex2` in `SceenChange_b.brlyt`, then plays `SceenChange_b_Left` or `_Right`. The original 41-frame BRLANs, including their 477-pixel movement, alpha curves, and clamped texture coordinates, are used directly.
- Pointer input is translated into the centered raster's coordinates, then routed to the original HTML controls. It does not multiply horizontal positions by the widescreen factor.
- The entry-path table at `0x81610A30` maps `ARG_INTERNET_SETTING` (1) to `Internet/Internet_index.html` and `ARG_INTERNET_PAGE` (4) to `index02.html`, relative to the exported locale directory. `MailAddressSelect` uses the former for its missing-network gate and the latter for its WiiConnect24 gate. The second route deliberately begins on Settings page 2.

## Browser implementation

`settings-raster-bridge.js` observes the isolated document, captures its completed computed layout, and relays nested frame surfaces. The host embeds the extracted images and original fonts into a self-contained SVG raster description. A canvas rasterizes it at 608×456; its pixels are converted to RGB565 and uploaded into old/new texture banks. `settings-surface.js` displays those textures and the original side panels through the existing WebGL renderer. Only local `/assets/` resources are permitted in raster descriptions.

Resource rewriting visits actual `src` attributes and CSS URLs inside `style`
attributes. It preserves literal page text and form values such as `url(a)`;
these must never become fetch requests. Quoted CSS text and comments remain
literal, while image URLs retain their XML-entity and CSS-escape semantics.

The engine remains sandboxed with `allow-scripts` only. Browser settings, firmware, networking and storage operations remain dummy state. Rendered input is forwarded by typed messages; the hidden frame is never granted same-origin access.

Optional host graphics enhancements keep the original logical layout but can
increase its raster scale. The default 2×2 SSAA mode rerasterizes the 608×456
page at 1,216×912 and resolves coverage without a finished-pixel blur. The
legacy post-process mode at 1× leaves the 608×456 page raster and fast
image-hover cache unchanged. Higher raster scales rerasterize outline fonts and
retain RGB565 quantization, with a 64 MiB bounded page cache. Integer-positioned
rollover images are predecoded at the selected scale and can update the retained
page without a new SVG raster; the authored HTML display size is used even when
a hover asset has a different intrinsic canvas size. Unsupported translucent
replacement cases retain the complete raster path. The menu composites the
completed Settings raster beneath HOME, pointer and keyboard layers before
applying any requested output color conversion. These are user enhancements,
not claims about native Opera rendering. See
[graphics options and resource ownership](renderer-resource-lifetime.md#optional-graphics-enhancements).

The inspector is available at `/settings-inspect.html` (append `?aspect=4:3` to check the narrow projection). It uses the same rendering module as the menu.

The menu passes `externalClock: true` and calls `surface.advance(frames)` in its main render loop, before advancing the scene fader. This draws both layers in the same animation frame. The first texture begins at counter −1 to share the global fader's initial update; later document crossfades begin at zero. The inspector uses the surface's own animation loop.

## Snapshot and hover performance

Pointer movement within an unchanged control no longer invalidates the document. The original mouse handlers still run; actual DOM mutations, image loads and form edits request updates. At most one raster job runs and one latest state waits, so obsolete pointer states cannot accumulate in an unbounded queue. Identical snapshots are skipped, recently rendered states are cached, and the aliases for each physical original font share one embedded face. This removes repeated embedding of the same 2.6MB font under several names.

The original main-page highlights and GIF arrows use declared image rollovers. The host predecodes those images and verifies each changed pixel: its old contribution must be transparent, or its new pixel must be fully opaque. Unchanged pixels remain in the base raster. This permits exact replacement over the retained **unquantized** page, including opaque GIF arrow artwork, without trying to invent pixels behind an image. Source geometry must resolve to integer raster positions; transforms, clipping, unsupported translucent replacements and other DOM changes retain the complete raster path. The final result still passes through RGB565 conversion and the same WebGL texture banks. Native texture and scene fades are unchanged. Closed Settings engines stop snapshot production; static textures are not redrawn each frame after their transitions finish.

The inspector's **Profile hover path** button reproduces 240 pointer movements over twelve visits to the four original page-1 buttons. On the tested local in-app browser, the optimized run measured **642.4ms first-page readiness**, **zero full page rasters**, **twelve image composites**, and **3–6ms input-to-raster latency** (median 3ms). The raster queue finished empty. The markup was 642,062 bytes and the embedded SVG was 4,171,336 bytes. These are measured results from this machine, not guarantees for other browsers; a comparable pre-change wall-clock baseline was not captured. The old code demonstrably queued a complete snapshot for every movement and embedded overlapping font aliases, but no unsupported speedup factor is claimed.

`surface.getPerformance()` and the canvas `data-performance` attribute expose readiness, full/cache/fast raster counts, input latency and queue counters. Focused tests verify burst coalescing, recovery after failed/cancelled work, physical-font deduplication, retained fallback order and pixel replacement equivalence over a colored background, alongside the original RGB565 and fade tests.

Settings snapshots also require successful loading of both original outline
faces. See [font identity and readiness](font-loading.md) for the isolated export
audit, controlled missing-font and retry regressions, and the remaining gap in
reproducing the reported intermittent font corruption.

### Arrow navigation measurements

The GIF rollover audit found an avoidable full page raster on arrow hover. The
verified replacement path removes it. A second delay came from scheduling hidden
iframe snapshots with timers: when an early snapshot saw an incomplete document,
the fallback interval could be clamped to roughly one second. Snapshot scheduling
now uses a coalesced `MessageChannel` task and explicit `load`/`readystatechange`
completion events, without a polling timer. A regression runs the bridge with
both timer APIs forbidden and verifies completed-page readiness and burst
coalescing.

The inspector's **Profile page arrows** button visits pages 1→2→3→2→1. The same
local in-app browser produced these measurements before and after replacing the
snapshot timers (GIF replacement was active in both runs):

| Destination         | Before: click to raster ready | After: click to raster ready |    After: raster work |
| ------------------- | ----------------------------: | ---------------------------: | --------------------: |
| Page 2, first visit |                        259 ms |                       170 ms | 112.8 ms, full raster |
| Page 3, first visit |                      1,145 ms |                       160 ms | 103.3 ms, full raster |
| Page 2, return      |                      1,042 ms |                        61 ms | 1.7 ms, cached raster |
| Page 1, return      |                        159 ms |                        55 ms | 1.4 ms, cached raster |

Each arrow hover produced one image composite and zero full rasters. Every queue
finished empty with submitted and processed counts equal. The post-change
navigation-message-to-raster times were 161.5, 149.7, 54.2 and 45.3 ms. These are
browser readiness measurements, not native Dolphin timings. They end when the
new raster is available; the source-derived forty-update scroll still follows.
First visits retain actual document loading and approximately 103–113 ms raster
work on this machine. Other pages and machines require their own measurements.

## Settings sound IDs and Options return

The original `MM_swapImage.js` writes `wii.se = 2`; the page arrows call
`_commonLeftScroll` / `_commonRightScroll` and write 1; the Back action writes 4.
The prior two-way numeric mapping therefore played a click for hovering. The
read-only USA 4.3 binary audit of `Setting::setSE` (`0x813F9834`, jump table
`0x81657700`) gives the following exact symbols, implemented in
`settings-sounds.js`:

| HTML value            | Native symbol                |
| --------------------- | ---------------------------- |
| 1                     | `WIPL_SE_BT_PUSH`            |
| 2                     | `WIPL_SE_BT_TARGETTING`      |
| 3                     | `WIPL_SE_DECIDE`             |
| 4                     | `WIPL_SE_CANCEL`             |
| 5                     | `WIPL_SE_CHOICE_CHG`         |
| 6                     | `WIPL_SE_CHAR_DELETE_ERROR`  |
| 10, 11, 12            | `WIPL_SE_OUTPUT_MODE_SELECT` |
| 30, 31, 32            | `WIPL_SE_CANCEL`             |
| 0 and unlisted values | No sound                     |

The native output-mode cases also change the console's audio mode; that hardware
operation remains a dummy. `www::wiisetting::Setter_` queues `soundId + 10` when a
sound mode is selected, which the bridge now preserves. The surface resolves pending `se`/`excse` once per menu update: a decision
replaces a hover from the same update, while an exceptional cue can replace an
ordinary hover. The native readiness counter additionally suppresses hover until
browser/scene work releases it and it reaches ten updates. That counter is not
a fixed ten-update delay after every click and remains an unmodeled boundary.
The table and queue alone are not proof of all sound timing equivalence.

Returning from Settings must recreate the Options entry. `Setting::calcFadeout`
selects scene 21 (`SCENE_SETTING_BG`) on the normal exit path at `0x813F351C`.
`SettingBg::create` creates fresh `SettingButton` and `SettingSelect` children and
starts the global fade-in. `SettingButton::calcFadein` waits for that fade to
complete, then plays `it_Button_a_SeenIn` on `G_BarIn`. Only after the button scene
finishes entering does `SettingSelect::stt_wait_button_fadein` play both
`ANIM_DATA_MANAGE_IN` and `ANIM_SETTING_IN`. Restoring a retained outgoing Options
pose skips the bars and both button entrances. Board-origin network gates retain
their separate local return destination.

## Validation and remaining differences

### Console Nickname, TV resolution and Connection Settings

The current input audit rechecked the exact USA 4.3 executable in Binary Ninja,
read-only. The mapped section's SHA-256 is
`45d4bcdc1396dab4babb498d0af5235dcbf6a2734e308fec6fd49c2296fe49db`;
its bytes match the original `00000098.app` slice at file offset `0x500`.
Decompilation source names are navigation hypotheses, not independent evidence.

The extracted `Nickname/Nickname_set.html` requests `formID=1`. The executable's
jump table at `0x81657290` sends that value to `0x813F4210`, which selects keyboard
type 6, maximum length 10 and one line. **The earlier assumption that this meant
the textinput library's internal configuration 6 is superseded.** The IPL manager
dispatch at `0x81356050` and its table at `0x81638DB8` translate this public type
through the memo vtable's `+0x108` slot to `0x8143D3B0`. That routine selects the
large textbox and permits QWERTY/phone switching, while disabling prediction,
language switching, line feed and the symbol panel. `0x8143D510` is a different
configuration reached by IPL type 7. The renderer's `console-nickname` profile
now follows the complete dispatch chain.

The same binary audit maps the other USA Settings inputs:

| IPL type | Configuration entry | Original textbox  | Input controls                                               |
| -------- | ------------------- | ----------------- | ------------------------------------------------------------ |
| 3        | `0x8143CDA4`        | `fs_VK_textBox_b` | Digits, telephone keytop                                     |
| 5        | `0x8143DA30`        | `fs_VK_textBox_a` | QWERTY/phone and symbols; no line feed                       |
| 6        | `0x8143D3B0`        | `fs_VK_textBox_b` | QWERTY/phone; no prediction, symbols or line feed            |
| 7        | `0x8143D510`        | `fs_VK_textBox_a` | QWERTY only; no prediction, symbols or line feed             |
| 10       | `0x8143D890`        | `fs_VK_textBox_b` | Digits and decimal point, telephone keytop                   |
| 13       | `0x8143DB88`        | `fs_VK_textBox_a` | Prediction without line feed; special-language answer branch |

The constructors at `0x8143CB80` and `0x8143CBDC` supply the original textbox A
and B filenames respectively. Numeric configuration `0x8141A5D4` hides the
original phone layout's alphabet/mode controls and nonnumeric keys; dotted
configuration `0x8141A878` restores key 11 with `.`. Secret input uses `*`, verified
in `textdrawer::put` at `0x814353F0`; the underlying value remains unmasked for
completion. Settings enables this mode for PIN verification form 17.

The Settings surface emits `keyboard-request` with `requestId`, `formId`,
`profile`, `nativeType`, `text`, `maxLength`, `rowLimit`, `secret` and the explicit restrictions. Its raster pointer
input stays locked while the host displays that keyboard. Calling
`surface.completeKeyboard({requestId, text, accepted})` updates the original
input and invalidates its raster; cancellation retains the old input. The
original page's **Confirm**, `setstring=2`, owns committing the edited nickname.
The completion is accepted only from the engine's parent and for the outstanding
request. It does not write console hardware or host settings.

`createSettingsKeyboard(layouts, {display, measureText, messages, predict, onSound, onResult, onComplete})`
in `settings-keyboard.js` owns the overlay lifecycle. `open(request)`, `advance`,
`presentation`, `hover`, `activate`, `keyInput`, `back`, `reset`, `active` and `getSnapshot`
let the menu retain its Settings raster beneath original keyboard panes. Its
`onResult` supplies the surface completion object as dismissal starts, so the
edited HTML raster updates beneath the closing keyboard. `onComplete` signals
that the 30-update dismissal has finished. Native `Manager::calc` at `0x8135563C`
sets state 3 on Edit→Disappear and state 4 on Disappear→hidden;
`Setting::calcKeyboard` at `0x813F44E8` writes the HTML input in state 3 and resumes
normal input in state 4. The host keeps pointer input intercepted while the
keyboard controller is active, including entrance and exit.
`reset()` silently drops the overlay and pending completion during a global
HOME→Wii Menu exit, so a later Settings entry cannot receive a stale form result.
Valid Settings fields open with an empty keyboard heading. The native
`initKeyboard` path passes the empty string at `r13 - 0x6EB6` to the manager
header setter (`vtable + 0x58`); the invalid-field path calls `0x813F6064`.
The earlier interpretation of the `setDefaultBackString` table at `0x81657508`
as an unconditional keyboard heading is superseded. Fresh native Console
Nickname frame 62270 in `address-settings-16x9` confirms a large blue input
inside `fs_VK_textBox_b` with no prompt above or overlapping it. Explicit
validation-specific titles remain supported by the wrapper.
The optional prediction provider is forwarded only to the shared keyboard;
profiles which disable prediction continue to do so.

Generic text fields also use the original row limits and a fifteen-update caret
scroll. `limitRowNum` at `0x81427E1C` disables word wrap when its limit is one;
`isOverRowLimit` at `0x8142706C` measures actual glyph layout before accepting
additional text. `doScroll`/`autoScroll` at `0x81420B90`/`0x81420CA8` use the
duration stored at `0x81694D88`. The renderer provides text metrics, and the
clipped text viewport moves with the keyboard during entrance and exit. Native
capture comparison of long text remains outstanding.

The non-letter keyboard's `AppearMemoState::calc` at `0x8143E9A4` moves its keytop
and textbox roots from y=−200 to zero over 30 updates using zero-slope Hermite
interpolation; alpha moves from zero to 255. The background root stays fixed and
fades. The toolbar's `N_DOWN` uses y/3, and `N_UP` uses −y/3. The upper toolbar
pane remains transparent until `EditMemoState::start` (`0x8143FFEC`). The exit at
`0x814405F0` reverses the motion and fades both toolbar panes. These transformations
are covered independently of keyboard editing in lifecycle tests. A fresh
capture is still needed to assess the composite entrance and text-raster return.

The dummy console now defaults to `dtv=1` and `progressive=1`, so the original
`Display.js` selects EDTV/HDTV (480p). With `dtv=0`, that same script selects 480i,
hides the EDTV interaction and uses its original `Btn_List_Dark.gif` artwork.
The USA resource does **not** disable Standard TV when EDTV is selected; it
remains selectable. Local `href="#"` choice links no longer acquire a document
navigation lock, because no replacement document arrives to release it.

Connection Settings froze because its original `List.css` contains three
`visibility:hidden` optional network icons referring to the absent
`Icon_Nin_WiFi_Connect.png`. The live browser does not paint those icons, but the
previous raster serializer tried to embed them and failed the entire page. The
snapshot now retains hidden geometry while omitting its unpainted image URLs,
and omits `display:none` subtrees. Children explicitly made visible still render.
Visible missing resources continue to report errors; no substitute icon is used.

Regression tests execute the extracted resolution and connection scripts against
the bridge, verify all three empty connection slots and the original EDTV
unavailable treatment, and cover nickname confirmation/cancellation, message
validation, local choice navigation and invisible resource handling. These do
not establish native keyboard entrance geometry or whole-page pixel equality.

### Local form and navigation coverage

The bridge handles the twenty form IDs used by the USA resources. Their limits
and keyboard types come from `Setting::initKeyboard` at `0x813F4194`, rather than
from HTML input types:

| Form IDs | Purpose                                        | Type | Character limit / rows            |
| -------- | ---------------------------------------------- | ---- | --------------------------------- |
| 1        | Console Nickname                               | 6    | 10 / 1                            |
| 2        | Security key                                   | 7    | WEP 26 / 2; other security 64 / 4 |
| 3        | SSID                                           | 7    | 32 / 2                            |
| 4–8      | IP, subnet, gateway and DNS                    | 10   | 15 / 1                            |
| 10       | Proxy address                                  | 7    | 255 / 16                          |
| 11       | Proxy port                                     | 3    | 5 / 1                             |
| 12–13    | Proxy credentials                              | 7    | 32 / 2                            |
| 14       | MTU                                            | 3    | 4 / 1                             |
| 15–17    | Parental PIN creation, repeat and verification | 3    | 4 / 1                             |
| 18–19    | Security answer and answer verification        | 5    | 32 / 2                            |
| 20       | Master key                                     | 3    | 5 / 1                             |
| 22       | Alternate security key                         | 7    | 64 / 4                            |

The native language 6/11 answer branch selects type 13. Forms 2, 13, 18, 19 and
22 start with an empty keyboard instead of copying the displayed sensitive field.
Keyboard cancellation retains the HTML field. The original page's Confirm or
arrow handler commits local strings through `setstring`, and its original
`funcResult` polling then advances. PIN repeat and verification choose the
original success/retry pages; master-key recovery remains an unavailable dummy.

The three connection slots now hold independent, versioned local NCD records.
Selecting a slot loads its fields; editing another slot does not overwrite them.
The label logic follows `checkFlag` at `0x813FA028`. Native `getUseProfileID` at
`0x813FB4F4` returns 3 when there is no active connection, so the empty list starts
without a selected connection. Selecting a local profile does not imply a
successful connection test: the getter requires the active and tested bits.
Each profile retains its own test flag. `checkChangeEnable` at `0x813FA354`
disables manual changes for special wireless types 1 and 2; `getDNSFlag` at
`0x813FA16C` clears automatic DNS when automatic IP is disabled.
Wired/wireless initialization uses the flag and
reset behavior at `0x813FAAD0`/`0x813FAB40`; clearing operates on the selected
record. Local function 20 saves normalized fields, while 10 clears and saves the
selected record. These correspond to the verified dispatcher at `0x81370FAC`
and NCD routines `0x813FB274`/`0x813FB1F8`; no NCD/IOS service is called.

Network Cancel restores the complete local edit backup without changing the
selected slot. Native routines `0x813FB300` and `0x813FB318` copy the same NCD
buffer in opposite directions; the browser copies its three local records and
active selection. Security values are masked in the original form while raw
keyboard completion stays available to the local validator. Parental restriction writes
preserve the original set/clear bit commands, and subpage state persists across
the original restriction pages. Cancel restores the committed restriction byte
through function 25, as in `0x81370FAC`; local clear resets the parental values.
Top-frame links are relayed inside the isolated
engine after their original click handler runs. The original parental return
script's `Re_setting_index.html` spelling is resolved to the actual archive name
`Re_Setting_index.html`. The Country footer preserves its original setup/normal
destinations and restores the saved selection on Back.

Unavailable pairing operations use the existing resources' terminal result 10
to return to their menu, instead of polling an absent native error dialog
forever. This is an explicit local service adaptation, not a reconstruction of
the native hardware failure dialog or its timing. No request performs host
network discovery, connection, firmware update, formatting or console writes.

### Native local validation messages

`Setting::checkTextNum` (`0x813F5BFC`) and the NCD validators now govern local
Confirm behavior. An invalid field remains on its original page with
`funcResult=4`; corrected input can be confirmed once the message disappears.
Nickname requires nonempty text containing something besides ASCII or fullwidth
spaces. PINs require four characters, and the master-key field requires five.
The USA secret answer requires six characters, with the verified alternate
language minima retained. The original extracted messages provide all text.

| Check             | Verified routine           | Local behavior                                                                                          |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| WEP               | `0x813FA484`               | Empty, 5/13 characters, or 10/26 hexadecimal digits                                                     |
| WPA               | `0x813FA484`               | Empty, 8–63 characters, or 64 hexadecimal digits                                                        |
| Proxy             | `0x813FA650`, `0x813F5618` | ASCII letters, digits, `_`, `-`, `.`; no leading/consecutive dot; converted 16-bit port must be nonzero |
| Proxy credentials | `0x813FA744`               | At most 32 printable ASCII characters per field                                                         |
| IP/DNS text       | `0x813F5E1C`               | Octets clamp to 255; abbreviated components after the first align right (`192.1` → `192.0.0.1`)         |
| MTU               | `0x813F57F0`               | 576–1500 retained; values outside that range become 0                                                   |

The validation call at `0x8134644C` is **`callBtn0`**, not a one-button dialog.
It uses `my_DialogWindow_a0`, hides `Wait_00` and `N_Prog`, and plays
`WIPL_SE_INFO_WINDOW`. The binary's `stt_normal` at `0x81345364` exits when
`++counter > 180`: after its original 25-update DialogIn, it stays for 181 normal
updates and plays the 21-update DialogOut. It does not expose an OK button or
permit early Back dismissal.

`createSettingsDialog(layouts, {messages, onSound, onComplete})` in
`settings-dialog.js` owns that overlay. The surface emits `validation-request`
with its request/message IDs and locks raster input. The host keeps the retained
Settings raster beneath the overlay and calls
`surface.completeValidation(requestId)` after `onComplete`. Global exit calls
the wrapper's `reset()` to discard completion. Tests verify the full timing,
noninteractive lifetime, original message placement, and reset behavior.

Focused tests cover RGB565 truncation/expansion, widescreen input centering, the integer fade, and the original page-scroll planes. Interactive browser checks exercise the three main pages and their original click navigation. The native source and binary establish the rendering structure and constants; these checks do not establish whole-frame pixel equality.

An earlier Dolphin comparison measured matching horizontal page-1 text bounds,
a one-row antialiasing difference and side-panel mean absolute RGB difference
0.85 after normalizing native 836×456 output to the browser's 832×456 canvas.
The user deleted that recording; these are historical measurements, not a
currently reproducible capture baseline. New native captures must replace it
before making a current graphical-equality claim.

`tools/reference/compare_settings_raster.py NATIVE_PNG BROWSER_PNG --output REPORT_JSON` reproduces the page 1 region comparison. Use the inspector's **Save comparison PNG** button for the unscaled 832×456 browser canvas. This comparison deliberately reports residual differences; it is not a whole-frame equality test.

The offscreen engine is Chromium, not the Wii's Opera binary. Font rasterization,
legacy layout behavior, paint scheduling and browser-load timing need explicit
native capture comparisons. Settings text fields have the original-keyboard
integration and local commit/cancel paths described above. Long textbox scrolling
still needs native capture comparison; hardware/service error dialogs, network discovery/result
scenes and exhaustive browser coverage of every subpage still need validation or
implementation. The HTML bridge's dummy service results do not imply complete
native scene coverage.

### Framed Country hover performance

The September 2026 Country investigation found that child-frame image changes
were serialized into a complete 487,128-byte document and a roughly 7.5 MB SVG
on ordinary hover. The bridge now forwards accepted fast-image IDs into each
child frame, namespaces them by frame, and forwards matching-sequence image
patches to the existing raster surface. A subsequent full snapshot includes the
latest image URLs. Stale sequence patches are ignored, and moving between frames
clears the previous frame's pointer target.

In the in-app Chromium browser at 832 × 456, the same 240-point Country sweep
produced 3 full and 8 cached snapshots before the change, versus 11 fast image
patches and no snapshots after it. The 11 observed image changes took 29–298 ms
before and 3–7 ms after; the first three slow changes measured 217, 298 and
294 ms. Cold first-ready time in these individual runs was 379.2 ms before and
296.9 ms after. These are two local runs, not cross-device performance bounds.
The inspector's unchanged initial target timed out in both runs and is excluded
from the interaction latency range.

Saved before/after canvases were close but not identical: mean absolute RGB
error 0.01296, maximum channel error 9, with 1,239 changed pixels. The ignored
`artifacts/browser-qa/country-frame-hover.json` report retains hashes, capture
paths and full measurements. Frame forwarding has regression coverage for ID
collisions, stale patches and avoiding a full snapshot.

Country and WiiConnect24 also contain original one-second JavaScript polling
timers around native function results. Those timers have not been shortened to
hide render latency. Their native readiness and transition timing, further cold
runs, and aligned native pixel comparisons remain open acceptance work.

### WiiConnect24 entry and hover audit

The September 2026 Chrome audit measured WiiConnect24 independently after the
Country frame forwarding change. Unlike Country, its index and ON/OFF pages are
single documents, and their rollovers already use the image replacement path.
A new Settings surface started on page 2, entered WiiConnect24, returned and
entered again, visited ON/OFF, selected On and visited the enabled index. Cold
here means empty surface resource caches; the ordinary browser HTTP cache was
retained. The test used the USA English resources and an 832 × 456 canvas.

Across the off index, repeated off index, ON/OFF choices and enabled index,
720 pointer movements produced 36 image composites, **zero full or cached page
rasters**, and **2–9 ms input-to-raster latency**. The host renderer created no
images, canvases or GPU textures and fetched no fonts during those hover sweeps.
It updated the existing texture once per changed highlight, and every queue
finished empty. This run does not reproduce a sustained hover bottleneck on the
current implementation; no additional hover optimization is claimed.

Entry remains visibly slower. Separate runs measured 1,265–1,930 ms for first
entry and 1,263–1,279 ms for a repeated entry. The cold raster itself took about
58–59 ms; the repeated raster cache hit took 1–2 ms. The original
`checkNWCFlag_index02` in `js/US/COM.js` explicitly waits 1,000 ms before calling
`waitNWCFuncResult_index02`. The extracted script's SHA-256 is
`d90d645071a233dd07e17f95c1291aa02541381e4cd16fe89167bd96b4396c53`.
The measurements include that original wait and browser scheduling/loading,
but exclude the following native 20-update crossfade. Hidden-frame timer
scheduling is a candidate for the variable excess delay; it has not yet been
isolated against native captures. The original delay is unchanged.

The same exercise exposed a navigation failure: Chromium's opaque sandbox ran
the original anchor's `onclick`, but skipped its `javascript:` URL action.
WiiConnect24 Confirm committed the local choice and then stayed on ON/OFF.
A minimal sandbox fixture reproduced the behavior for both an image and its
anchor. The bridge now handles the three call signatures present in the
extracted pages—`jump_ONOFF_set()`, `jumpPare_index02()` and
`jump_Connect_set_top(0..2)`—by invoking their existing page functions after
`onclick`. Cancelled clicks remain cancelled. It does not evaluate arbitrary
JavaScript or relax the sandbox. Confirm reached the enabled index in 117 ms
in the first repaired run, with no reported JavaScript errors.
The final Chrome 153 pass also completed Off return, Parental Controls and all
three connection-slot links. These remain isolated local-state operations.

The ignored `artifacts/settings-wc24-profile/` directory retains the explicit
browser fixture, before/after captures and timing/resource counts. Browser
navigation driven by a page's own script has no host navigation-start marker;
its `lastNavigationReadyMs` is now null instead of inheriting the previous
document's duration. The fixture measures click-to-ready time directly.
Native Opera text rasterization, the entry timing comparison and whole-page
pixel alignment remain open; this audit establishes neither 1:1 rendering nor
native network-service behavior.
