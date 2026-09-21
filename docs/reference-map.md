# Original-resource reference map

The target is the Wii System Menu channel screen and related interfaces. The
HOME overlay is a separate interface with its own resources and state. Evidence
comes from the supplied WAD, its validated contents, the executable and channel
scripts in those contents, and recordings of that original software. Browser
code and tests describe the implementation; they do not prove native fidelity.

## Identify the input first

The initial inspected System Menu is USA 4.3, title 0000000100000002, version 513. Its WAD SHA-256 is
bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb.
Preparation validated nine decrypted contents against their TMD lengths and
SHA-1 hashes. Address findings apply only to that executable. Its 00000098.app
second DOL data section starts at file offset 0x500 and maps to 0x8132FFE0.
A filename alone does not establish version or provenance.

Previous native recordings were deleted. Replacement recordings now exist
under `artifacts/captures/`. The reviewed `address-settings-16x9` session ended
cleanly with 63,363 presented images at 836×456 and retained DSP/DTK audio.
Its Address Book, HOME, SD and Console Nickname anchors are indexed in the
[retained evidence ledger](fidelity-evidence.md), together with input/runtime
hashes and explicit comparison limits. The available native sequences establish
observations; they do not establish complete browser image/audio equivalence.

## Interface to original resources

| Interface                | Original resources                                                 | Browser implementation                                             |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Grid and paging          | chanSel.ash; my_IplTop_a.brlyt/.brlan                              | main.js and channel page controller                                |
| Footer and arrows        | cmnBtn.ash; my_IplTop_e.brlyt/.brlan                               | footer-controller.js                                               |
| Channel focus            | my_IplTop_d; FocusOff, FocusOn, Select                             | main.js                                                            |
| Icon and banner          | Each title's icon/banner BRLYT, BRLAN and script resources         | channel-animation.js                                               |
| Preview controls         | chanTtl.ash; my_ChTop_a and associated BRLANs                      | Preview controller                                                 |
| Empty Disc Channel       | diskThum.ash/my_DiskCh_b; diskBann.ash/my_DiskCh_a                 | Disc layouts and animation controller                              |
| Pointer and grab         | cursor.ash; P1_Def and P1_Cat                                      | main.js and channel-drag.js                                        |
| Clock                    | my_Clock_a; Change, Min, NumApear, NumLost                         | clock.js                                                           |
| Wii Options              | setupSel/it_ObjSetUp_a; setupBg/it_BgSetUp_a; setupBtn/it_Button_a | menu-scenes.js                                                     |
| Health warning           | it_Has_a; SeenIn, Push, SeenOut                                    | Health controller                                                  |
| SD icon and grid         | mn_Sdcard_Btn; mn_SdcardMenu_a/b/d                                 | sd-button.js and sd-menu.js                                        |
| SD information           | my_DialogWindow_a2 and original messages                           | sd-menu.js                                                         |
| Settings                 | html/US2/iplsetting.ash; HTML/CSS/scripts/pictures and BG_16x9.tpl | settings-bridge.js, settings-surface.js, settings-raster.js        |
| Board, Calendar and Memo | Original Board, Calendar, LetterS and keyboard packages            | menu-scenes.js, board-calendar.js, board-memos.js, board-create.js |
| HOME and remote controls | homeBtn1/th_HomeBtn_d; homebutton/home.csv and SpeakerSe.arc       | home-overlay.js                                                    |

Keep identifiers unchanged, including Cursur_a, Foucus, NumApear and ChangeRoop.
They are resource keys.

## Interpreting the resources

BRLYT supplies pane order, hierarchy, origins, visibility, material references,
texture coordinates and group membership. BRLAN supplies keyed values, step
interpolation, Hermite tangents and animation intervals. TPL and fonts supply
pixels and metrics. Inspect them together: a changing material alpha cannot
make a hidden pane visible, and a decoded texture does not prove correct blend
or clipping.

The application separates logical projection, framebuffer and displayed ratio:
608×456 for 4:3 and 832×456 for 16:9 project into the original 640×456 NTSC
framebuffer. It preserves pane location-adjustment flags, root
scaling and wide texture donors. The grid contains four columns, three rows
and four pages. Current-page anchors N_Ch_c01 through N_Ch_c12, adjacent-page
groups and clipped edge strips all participate in composition. Capture pixels
may have different dimensions from either logical projection.

Implemented paging uses intervals 0–20 and 40–60. Opening uses the grid interval
200–228 and a 28-update corner interpolation. Preview capture opacity is
quantized to an integer out of 255. Original ChMask and the preview's outside
black composition remain separate layers. Resource and regression checks cover
these rules; complete native frame comparisons remain required. See
[scene adapters](scene-adapters.md).

## Executable findings with explicit locations

All addresses refer to the identified USA 4.3 executable.

| Finding                                                        | Location                                                                                           | Detailed notes                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| SD has 20 pages and original page intervals                    | Constructor 0x813DAB08; paging 0x813E03B0                                                          | [Footer and SD](footer-and-sd.md)                                                                        |
| Empty SD tiles share a layout; wide donors are copied          | 0x813E11C4, 0x813DEF68, 0x813DE9FC                                                                 | [Footer and SD](footer-and-sd.md)                                                                        |
| Welcome and manual Help use different message tables           | 0x8165439C, 0x8165440C                                                                             | [Footer and SD](footer-and-sd.md)                                                                        |
| Settings browser raster is 608×456                             | 0x813F1344                                                                                         | [Settings rendering](settings-rendering.md)                                                              |
| Settings RGB565 conversion and 20-update raster fade           | 0x8136F2D0, 0x813F355C, 0x813F20AC                                                                 | [Settings rendering](settings-rendering.md)                                                              |
| Memo keyboard entrance/exit and editor scroll                  | 0x8143E9A4, 0x814405F0, 0x8143FFEC                                                                 | [Keyboard notes](keyboard-source-notes.md)                                                               |
| Valid Settings keyboard fields have no heading                 | initKeyboard header setter vtable +0x58, empty string at r13−0x6EB6; invalid-field path 0x813F6064 | [Settings rendering](settings-rendering.md); native Nickname frame 62270                                 |
| HOME input, state advancement and sound callback               | 0x81375B78, 0x81372E9C, 0x81377080                                                                 | [HOME notes](home-menu-source-notes.md)                                                                  |
| Empty SD loading completes without populated-card time minimum | 0x813DBEB8–0x813DBEF0; populated path 0x813DBFE0–0x813DC06C                                        | [Footer and SD](footer-and-sd.md); native entry 49577–49625                                              |
| Address Book repeated pages and page counts                    | Draw 0x813822DC; initialization 0x81382804                                                         | [Address Book notes](address-book-source-notes.md)                                                       |
| NTSC framebuffer is 640×456 independently of TV aspect         | Mode records 0x81634FA8/0x81634FE4; viewport call 0x81334CBC                                       | [Address Book sampling investigation](address-book-source-notes.md#sheet-edges-and-original-framebuffer) |

Do not transfer these addresses to another version without remapping and
validating its executable. New findings should record their content hash and
mapped section.

## Channels, fonts and audio

The menu WAD supplies common interface assets and the empty Disc Channel.
Separate channels require their own WADs or an explicit NAND import. Export
validates IMD5 payloads and converts original icon/banner packages. A valid
supplied iplsave.bin provides an initial arrangement. Native module/script flags
mean that layout playback alone may be incomplete; supported branches are
recorded in [the channel audit](../tools/assets/CHANNEL_SCRIPTS.md).

Font conversion preserves original glyph metrics and outlines. Browser text
rasterization can still differ. IplSound.brsar contains sequences, banks, waves
and streams; an isolated sample is not a complete cue. Compare onset, overlap,
envelopes and loop behavior separately from successful decode.

Custom channels are an application extension. Their animated example and
generated oscillator audio are original project assets, not native reference
material. [Channel management](channel-management.md) describes WAD imports,
custom packages, per-ID visibility and collision-free saved positions.

## Reproducible work

Preparation and native recording take explicit inputs. No research checkout or
fixed private path is a runtime dependency. [Native recording](native-reference.md)
and [analysis commands](../tools/reference/README.md) describe the workflow.
Extracted original graphics, fonts, sound, WADs, NAND files and captures remain
local. Public cryptographic constants and authored example assets are distinct
from those extracted resources.

The capture ledger distinguishes native stills and observed phase order from
paired browser measurements. In particular, Address Book sheet-edge comparisons
measure only two settled poses, HOME caption stills establish the serif font
style, and the SD sequence establishes that loading overlaps fade-in. None of
those findings closes the full-transition acceptance requirements in
[the fidelity plan](fidelity.md).
