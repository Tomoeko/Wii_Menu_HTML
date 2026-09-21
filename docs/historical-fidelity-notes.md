# Historical fidelity notes — recordings unavailable

The notes below were inherited from an earlier revision. On September 21, 2026,
the referenced capture directories and PNGs were absent from this workspace.
Their reported measurements have not been reverified and do not satisfy current
acceptance. References to retained recordings below describe their historical
state, not current availability. See [current evidence](fidelity-evidence.md).


This ledger records available evidence, its provenance and the limits of each
finding. It does not declare 1:1 fidelity. Original recordings are ignored local
artifacts; their links resolve only in a workspace retaining those recordings.
The [fidelity plan](fidelity.md) defines acceptance separately from implementation
tests and successful capture completion.

## Capture provenance

The reviewed [Address/Settings session metadata](../artifacts/captures/address-settings-16x9/capture-session.json)
records a clean exit on 2026-09-18 at 01:06:44 UTC, exit code 0, 63,363 PNGs and
final ordinal 63363. Images are 836×456, USA NTSC 16:9, Metal raw XFB at native
internal resolution, with duplicate-XFB skipping disabled. DSP and DTK WAVs are
retained in its `Audio/` directory. The isolated local Dolphin ARM64 JIT build
executed the supplied original WAD; these are emulator references, not physical
console recordings.

- WAD SHA-256: `bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.
- Emulator SHA-256: `7c43b3e6226322cd0fd9acf491a58212e72530c6d1afbe5895c9b34cc809ec24`.
- No saved-state baseline was supplied; `saveStateSha256` is null.

All numbers below are **presented-XFB ordinals**. They are not wall-clock
timestamps or a general simulation-update clock. Input was performed through
the isolated runtime's Wii Remote TAS controls; settled anchors can occur long
after the relevant press. Binary/resource durations are separate evidence.
The capture's [input and observation index](../artifacts/captures/address-settings-16x9/analysis/home-sd-reference-evidence.json)
records the tested paths and distinguishes intervals from settled stills.

Two other replacement sessions are retained: [settings-board-16x9](../artifacts/captures/settings-board-16x9/capture-session.json)
ended cleanly with 11,761 images; [roadmap-16x9](../artifacts/captures/roadmap-16x9/capture-session.json)
retained 23,536 images but ended with exit code −6. This ledger assigns no
additional comparison result to either session. An abnormal exit must not be
described as a clean audio/capture completion.

## Reviewed Address Book observations

The [transition report](../artifacts/captures/address-settings-16x9/analysis/address-transition-evidence.json)
and entry/exit contact sheets retain these observations:

| Case                            | Native ordinals                                                                                         | Finding and limit                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create selector → Address cover | 13237 first footer motion; 13254 settled book bounds; 13259 settled footer                              | Constrains the ordinary mode-zero entry and footer order. It does not validate other entry modes.                                                      |
| Settled cover                   | [13758](../artifacts/captures/address-settings-16x9/Frames/framedump_13758.png)                         | Native sheet-edge reference for the bounded raster comparison below.                                                                                   |
| Settled page one                | [17655](../artifacts/captures/address-settings-16x9/Frames/framedump_17655.png)                         | Second settled sheet-edge reference.                                                                                                                   |
| Cover → Create selector         | 25048 first book motion; 25064 selector restored; 25069 footer slide begins; 25095 left footer endpoint | Supports concurrent selector/book shrink and later footer replacement. Page-one Back has regression coverage, but this native exit was from the cover. |

The [sheet comparison report](../artifacts/captures/address-settings-16x9/analysis/address-sheets/README.md)
retains native/browser PNG hashes and exact crop definitions. Both input PNGs
were compared at 836×456 without resampling. Switching the browser's internal
raster from direct 836×456 to original 640×456 reduced cover left-edge RGB mean
absolute error from 13.30 to 8.13; the corrected page-one crop measures 8.43.
The white-face thresholded envelope matches all 245 measured rows in those two
corrected candidates. Maximum component error remains 35 in both corrected
edge crops. These are **measured approximations** of settled regions, excluding
pointer, footer, background and console-number text. They establish neither
full-frame equality nor animated turn/wrap timing. See the
[executable analysis](address-book-source-notes.md#sheet-edges-and-original-framebuffer).

The [entry and cover-exit sequence reports](../artifacts/captures/address-settings-16x9/analysis/address-sequences/README.md)
now compare all 29 browser entry poses and 49 cover-exit poses to the retained
native intervals. Monotonic pixel matching permits repeated or skipped native
images; it does not equate ordinals with updates. The selected upper-book region
measures mean absolute RGB error 0.687 on entry and 0.653 on exit, while the
selected edge strips measure 2.289 and 1.391. These regions exclude the console
number, pointer, central date and differing fixture content. Original pixels,
explicit region definitions, PNG/resource hashes and the candidate's authored
source hashes are retained. The reports identify missing intermediate footer
poses and uncertain global arrow-loop phase. Page-one exit has a browser
regression export, but no corresponding native exit in this recording.

## Reviewed HOME and remote-control observations

The [HOME contact-sheet collection and measurements](../artifacts/captures/address-settings-16x9/analysis/home-sd-reference-evidence.json)
retain the following tested sequence. Motion intervals describe visually
reviewed native phases; browser boundaries and audio onset have not been paired.

| Case                           | Native anchor or interval                                                                                                  | Observation                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open HOME over Create selector | Motion 27014–27033; settled 27920                                                                                          | Header/footer enter, central Wii Menu button appears, previous scene remains underneath.                                                         |
| Open Wii Remote Settings       | 30152 rise begins; panel expansion 30166–30177; controls fade 30178–30184; settled 30825                                   | Remote movement precedes the expanded controls.                                                                                                  |
| Volume minus, then plus        | 32370; 34316                                                                                                               | One lower volume step, then restoration to the initial bar count.                                                                                |
| Rumble Off, then On            | 36188; 37939                                                                                                               | Both selection states retained.                                                                                                                  |
| Close remote settings          | Contraction 38681–38688; remote descent/header return 38695–38710; settled 39352                                           | Controls disappear before the remote returns to its footer position.                                                                             |
| Close HOME using HOME          | Header flash 39711–39730; exit motion 39731–39750; settled 40657                                                           | Header press feedback occurs even with the pointer over the lower bar.                                                                           |
| Wii Menu confirmation          | Dialog entry 42040–42059; stills [42989](../artifacts/captures/address-settings-16x9/Frames/framedump_42989.png) and 46702 | Caption is serif; Yes/No picture labels are sans-serif. This establishes font style, not pixel equality.                                         |
| Answer No                      | Dialog return 43991–44009; settled 44747                                                                                   | Dialog travels upward; HOME remains open.                                                                                                        |
| Answer Yes                     | Black begins 47531; native loading silhouettes follow; complete grid anchor 48057                                          | Whole confirmation/HOME fades out. No reverse-dialog travel is observed. Native menu reinitialization is not a browser service-timing guarantee. |
| Rumble On while already On     | 53218                                                                                                                      | Separate captured press case, available for the original shake/selection comparison.                                                             |
| Reconnect and hold 1+2         | Prompt [54285](../artifacts/captures/address-settings-16x9/Frames/framedump_54285.png); returned controls 55501            | Native prompt uses a serif caption; emulated 1+2 successfully reconnects player one. Both buttons were released afterward.                       |

Volume and rumble were restored to their initial state. The browser's pairing
fixture remains a local substitute for WPAD callbacks. Native multi-controller
ordering, hardware vibration/speaker behavior and reconnect error branches are
not validated by this recording. [HOME notes](home-menu-source-notes.md) identify
the separate executable/resource findings.

## Repeat SD entry and Console Nickname

The inserted card had already completed its first visit. **No welcome dialog
appeared in this repeat-entry recording.** The [SD measurements](../artifacts/captures/address-settings-16x9/analysis/sd-entry-measurements.json)
and [fine contact sheet](../artifacts/captures/address-settings-16x9/analysis/sd-entry-fine.png)
show fade-out at 49548–49567, fully black images 49567–49576 and scene fade-in
49577–49596. Loading entry is visible during that fade, completes by 49609, and
exits at 49610–49625. The settled empty SD grid is frame 50144. This establishes
overlap of loading and scene fade; it does not validate a first-visit sequence,
populated media or media errors. The binary empty-card branch closes immediately
after entry; the one-second minimum belongs to populated reconciliation. See
[SD controller evidence](footer-and-sd.md).

The native Console Nickname page is frame 61004; its
[keyboard at 62270](../artifacts/captures/address-settings-16x9/Frames/framedump_62270.png)
shows only the blue input value inside the large textbox, without an instruction
heading. QWERTY/phone switching is present; prediction, language and symbol tabs
are absent. The field was opened without editing or confirming its value.
The browser's injected heading was removed using this observation and the
original valid-input header call. Geometry, glyph rasterization and the entire
keyboard entrance remain unaccepted until aligned candidate comparison.

## Missing comparisons

The deleted historical sessions cannot support reproducible current results.
In particular, the previous Memo posting/reading/Trash and prediction/multi-tap
recordings have not been replaced by the HOME/Nickname cases above. Native and
browser audio are retained or generated separately, but no synchronized
sample-level comparison is reported here. Complete sequence acceptance, 4:3,
other regions and other browser pipelines remain open.
