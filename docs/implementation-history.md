# Implemented baseline before the September 2026 regression review

These entries preserve the prior implementation record. They are not a statement
that current regressions or native acceptance checks have passed. The active
work and completion criteria are kept in the local, untracked `ROADMAP.md`.


### Standalone project and channel management

- [x] Consolidate the maintained application into `Wii_Menu_HTML-Final`, with
      readable source, development instructions and no neighboring-project dependency.
- [x] Prepare original resources from an explicit user-supplied WAD, validate
      content integrity and keep original/private/generated files out of public source.
- [x] Default to 16:9; provide readable configuration for health-screen skipping,
      SD-card enabled state, audio, HOME bindings and middle/right-button grabbing.
- [x] Provide the custom-channel CLI, declarative template and animated example
      with original example audio, documentation and a dummy Start button.
- [x] Provide Channel Manager for guided creation, PNG/JPEG/GIF/WAV uploads, authored-folder
      import, original example installation/repair, production-renderer previews
      and reversible Show/Hide controls. Retain editable source folders locally,
      reject duplicate IDs and report full-menu, hidden and missing-layout states.
- [x] Keep uploaded artwork stationary, preserve its displayed aspect ratio with
      configurable background/accent, and document recommended icon/banner sizes.
      Decode GIF frames with the built-in compositor and retain their delays and loops.
- [x] Add recoverable Delete/Trash/Restore for imported and custom channels;
      preserve source files, visibility and preferred positions, protect Disc,
      reject conflicting IDs and report missing resources before restoration.
- [x] Share System/Light/Dark appearance across Channel Manager, previews and
      inspectors without changing the colors of rendered channel resources.
- [x] Render complete custom Start placeholder text using a font that contains
      every requested character, with a local system-font fallback for host notices.
- [x] Add/remove/enable/disable imported and custom channels with stable IDs,
      saved placement, fixed Disc position and non-overlapping slots.
- [x] Test duplicate IDs, full menus, re-enabling, missing resources, removal,
      invalid configuration, and arrangement persistence through drag/reload.
- [x] Remove obsolete project references and private workspace input defaults;
      complete the readability audit, including embedded scripts and inspector CSS.

### Menu, channels, footer and audio

- [x] Replace the required external channel-audio converter with the built-in
      BNS DSP ADPCM / PCM WAVE decoder. All 13 installed sounds match retained PCM
      exactly (4,485,340 sample values), including loop markers; isolated preparation
      also succeeds without external audio binaries on PATH.

- [x] Render original layouts, textures, bitmap fonts and animation resources,
      with held channel hover, tooltips, pointer hit testing and four-page navigation.
- [x] Keep the clock/date across page changes and retain the final health exit
      pose through the handoff instead of redrawing the warning for one frame.
- [x] Implement channel icon/banner clocks, Shop title initialization, preview
      sound playback, original channel masks, clicked-slot zoom and return animation.
- [x] Restore Disc preview sound and the Board/Memo/Address hover cues.
- [x] Preserve the background soundtrack's loop position while a channel preview
      is open, then resume after the Wii Menu return zoom. Closing HOME within a
      preview keeps it suspended; a full HOME-confirmed restart resets it.
      Regression tests cover actual source offsets, loop wrapping and delayed loads.
- [x] End the floating grabbed-channel layer when placement completes; persist
      placement and correct drag-loop lifetime, volume and source-loop handling.
- [x] Share persistent arrow focus/press behavior across Home Menu, SD, channel
      previews, Address Book, Board days and Calendar months. A click no longer
      removes a still-hovered bubble.
- [x] Remove the preview-arrow audio burst caused by hidden footer hover during
      locked transitions. Verify the original page sample independently without
      altering its PCM; keep the original `WSD_SELECT` mapping.
- [x] Implement footer tooltips/cues, SD icon disappearance/return, Options
      entry and the Message Board return layering/date ownership corrections.

### Address Book

- [x] Implement cover/page turns, repeated page stacks, changing base geometry,
      end-to-cover wrapping and the verified page-flip cue IDs.
- [x] Render the thin sheet edges through the original 640 × 456 framebuffer
      stage; separate the rotating sheet from the closed-cover presentation.
- [x] Correct ordinary Create entry/exit ordering, manual page-root alpha,
      parent/child update stagger and arrow appearance/disappearance clips.
- [x] Preserve the active page during Back instead of resetting to a profile
      before the book has finished disappearing.
- [x] Hide the inactive `N_note_move` layer so its registered-user/Mii silhouette
      cannot appear beside Memo and Letter on return. Cover/page-one exits and
      extended idle holds have renderer tests and browser checks.

Bounded native comparisons support the sheet-edge and entry/cover-exit fixes.
The measured mean RGB error in the stated edge strips fell from 7.500 to 2.289
on entry and 7.331 to 1.391 on cover exit (0–255 scale). Residual differences,
other regions of the frame and page-one exit are not accepted by those results.
See [Address Book evidence](docs/address-book-source-notes.md).

### SD Card Menu and HOME

- [x] Implement the SD grid, counter, fades, welcome/Help pages and original
      loading prompt. The empty-card branch uses 33 entrance updates followed by
      16 exit updates during scene fade-in; it does not inherit the populated-card wait.
- [x] Use original HOME and Wii Remote Settings groups and all 22 HOME sound
      identifiers, with Home/H input ownership and independent control animations.
- [x] Implement Return to Wii Menu confirmation, No returning to HOME, and Yes
      handing off to the original BackMenu loading layout before a fresh grid.
- [x] Import BackMenu directly from the supplied executable, with source hashes
      and derived archive address. Preserve loading, fade, black-wait and grid stages.
- [x] Prevent confirmation text and HOME bars from regaining draw ownership for
      one frame at restart handoff; cover single, fractional and batched updates.
- [x] Implement volume steps/limits and remote glow, Rumble On shake, and local
      reconnect presentation including P1 battery animation and connection cues.
- [x] Export the original localized HOME captions and five remote-speaker PCM
      effects directly from the WAD.

The restart service waits are documented local defaults fitted to the retained
capture; they are not firmware timing constants. Pairing and rumble operate on
local state. See [HOME evidence](docs/home-menu-source-notes.md),
[restart evidence](docs/menu-restart.md) and [SD evidence](docs/footer-and-sd.md).

### Message Board and Data Management

- [x] Implement day arrows, Calendar/Today and Create Message navigation with
      original resources and locally editable Memo input.
- [x] Persist readable local memos; implement posting, placement, dragging,
      reader scrolling, erase feedback, Calendar markers and footer counts.
- [x] Keep memo cards behind returning channel tiles throughout the Board exit.
- [x] Give Board return, page arrows, memo selection and erase their own verified
      sound requests without additional host confirmation/cancel cues.
- [x] Provide breadcrumbs, Wii/SD and Slot A/B tabs, translucent empty blocks,
      independent block hover and a delayed, centered dummy-save title balloon.
- [x] Correct selected-tab ownership, show “Nothing is inserted in Slot B.” and
      provide local dummy Move/Copy/Erase detail and confirmation flows.

These are implemented local fixtures, not complete message/storage services.
See [Memo behavior and limits](docs/message-board.md) and the
[implementation coverage table](docs/implementation-plan.md).

### Wii System Settings and keyboard

- [x] Render the original Settings page engine into a 608 × 456 RGB565 surface
      with native projection/fade ownership instead of displaying a stretched iframe.
- [x] Cache/coalesce Settings raster updates and remove the measured hidden-page
      timer stall while retaining native transition lengths.
- [x] Map verified native Settings sound IDs, arbitrate pending requests per
      update and restore a fresh animated Options scene on Back.
- [x] Fix Connection Settings freezing on hidden optional image references;
      keep original pages responsive across isolated local connection profiles.
- [x] Preserve original TV Resolution selected/unavailable logic: EDTV is selected
      for the default capable fixture; Standard TV remains selectable when the
      original USA script permits it.
- [x] Open the original Console Nickname keyboard without dictionary controls,
      with its ten-character limit, empty heading, Quit label and accept/cancel flow.
- [x] Support verified Settings text/numeric/secret profiles, local validation
      dialogs, row limits, caret scrolling, and cancellation/reset ownership.
- [x] Implement keyboard modes, symbols, dictionary/language controls, candidate
      paging and physical input through the original keyboard resources.
- [x] Separate Caps selection color from pointer focus. It returns to normal
      size on departure; a pointer still inside retains the native selected-hover
      pose. Hover alone does not change selection color.
- [x] Suppress hover animation on the selected keyboard-mode button while the
      inactive gray mode retains its hover feedback.
- [x] Play only the rejection/drum cue for rejected characters or candidates;
      accepted characters and candidate selections use their respective normal cues.
- [x] Synchronize physical Caps Lock from modifier state on either event edge,
      provide a missing-state fallback, and release held Shift on focus loss.
      Releasing one Shift no longer clears another Shift that is still held.
- [x] Provide an optional local worker running the supplied USA 4.3 original
      dictionary engine, with clean-context English/French/Spanish checks.

Settings hover measured 3–6 ms over twelve composites and zero full rasters for
240 pointer moves. A four-page navigation sequence improved from
259/1145/1042/159 ms to 170/160/61/55 ms after the timer correction. These are
browser performance measurements, not native timing acceptance. See
[Settings measurements](docs/settings-rendering.md),
[keyboard evidence](docs/keyboard-source-notes.md) and [audio limits](docs/audio-cues.md).

## Previous release checks


- [x] Verify fresh preparation from the supplied WAD with no explicit key file,
      private workspace state, copied assets or neighboring project dependency.
- [x] Verify the latest clean preparation retains BackMenu layout/textures and
      executable/archive hashes, all 22 HOME effects, five sample-exact speaker
      PCM exports and four original HOME captions.
- [x] Run authored-source and fresh generated-text privacy audits. The latest
      isolated preparation passed 25 checks with no path/key-pattern findings.
- [x] Document readable configuration, setup, troubleshooting, channel authoring,
      backup/import/export and the boundaries of local dummy operations.
- [x] Publish the versioned evidence matrix distinguishing measured, approximate,
      implemented-but-unverified, dummy and unimplemented behavior.
- [x] Verify public common-key constants against official Dolphin source, retain
      explicit overrides/content checks and label cosmetic obfuscation accurately.
- [ ] Before publishing, review the exact tracked/staged files for private
      usernames, home paths, console identifiers, WADs, keys, original fonts,
      graphics, recordings and generated assets. Re-run both privacy audit modes
      and review unintended network requests; prior audits do not replace this step.

The CLI/template release smoke checks and latest WAD-only preparation are local
validation, not a publication or a 1:1 certification. See the
[version 0.1.0 evidence matrix](docs/fidelity.md#evidence-matrix-version-010),
[release privacy checks](docs/privacy-release.md) and
[custom-channel guide](docs/custom-channels.md).
