# Empty Disc Channel animation

The browser's empty Disc preview uses the original USA 4.3
`diskBann.ash` / `my_DiskCh_a` layout and `my_DiskCh_a_Start` BRLAN.
The resource contains 141 frames; its forward controller holds frame 140.
The input WAD SHA-256 is
`bf814c6eb13cf71ab4afe1a1464f3ae27c5a16767030c693abf05e14724f2bbb`.

A read-only Binary Ninja check established that the native preview advances
this same layout **twice per scene update**:

- `0x813B6200` assigns the empty Disc layout at object offset `0x254` to the
  active channel banner at offset `0x23C`.
- `0x813B4D10` calls layout calculation first through `0x254` in the Disc
  branch and later through `0x23C` whenever the active banner exists. These
  pointers alias for the empty Disc preview.
- `0x8136A704` advances each bound animator. `0x81369BBC` calls the shared
  frame controller at `0x81362890` and then publishes its frame to NW4R.
  The animator constructor at `0x81369ABC` uses the resource frame count minus
  one for a forward animation and its default unit step.

The browser now routes that preview through `poseEmptyDiscBanner`, sampling
at two BRLAN frames per update and retaining the authored endpoint. This is
an executable-derived rate correction, rather than an estimated speed factor.
Prepared-resource tests verify the Wii and GameCube disc angles at updates
0, 10, 30 and 70 and the final held pose. At update 10 both discs are 165°;
at update 70 both are approximately 360°.

The menu thumbnail is separate. `0x813ABA24` creates its looping
`my_DiskCh_b` animation, and `0x813ABF68` calculates that layout once. Its
360-frame loop retains the existing rate. Inserted-disc, unknown-disc, eject
and hardware transitions are outside this correction.

Native recording alignment is still required to accept exact onset, render
phase and pixel geometry. Presented frame ordinals must not be assumed to equal
simulation updates, and the local test does not establish complete native
visual or audio equality.

A new full-cycle pair is retained under `artifacts/menu-comparison/disc-entry`: 
121 browser updates against native ordinals 20830–20990 from the clean
`roadmap-menu-return` session. The report records WAD/PNG/source hashes and the
explicit horizontal Lanczos normalization. Rotating disc poses follow the
corrected twice-advanced clip throughout startup and settle. This is bounded
rotation evidence; preview-arrow onset, fonts and complete-frame pixels retain
separate differences. See [transition report](menu-transition-regressions.md).
