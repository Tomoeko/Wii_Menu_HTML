# Font identity and readiness

The menu and Settings use different original font resources. The menu renders
BRFNT/RFNA bitmap glyph sheets; Settings renders the two original Opera TTC faces
through the browser. A correctly mapped source font does not establish that
Chromium reproduces Opera's rasterization.

## Resource audit

The local USA 4.3 resource audit on 2026-09-21 found three physical bitmap faces:
the menu's Rodin 48 face and the shared Rodin 32 and Utrillo 32 faces. Manifest
aliases resolve to the intended physical descriptor. Menu initialization deduplicates
faces by descriptor URL and awaits their image loads before starting the scene.
The development server sends generated resources with `Cache-Control: no-store`.
No swapped bitmap face or invalid character-to-glyph mapping was reproduced.

An isolated export from the supplied decrypted contents regenerated the shared
bitmap fonts and original outline collection inside an automatically cleaned
temporary directory. The two shared faces' character mappings all referenced
valid glyphs, their source descriptors matched the prepared manifest, and both
outline SFNT checksums were `0xB1B0AFBA`. All **141 generated files** in that
export's font directory matched the existing files byte for byte. The source
SHA-256 identities remain recorded in the private generated manifest; source
resources and generated glyphs are not committed.

The outline collection maps face 0 to `Wii NTLG Gothic` and face 1 to
`Wii NTLG PGothic`. Latin, Japanese and original legacy aliases retain those
identities. The existing exporter repair affects only the invalid U+FFFF missing
glyph sentinel needed by modern browser font validation; assigned glyph outlines
and metrics are retained. The shared-font and outline export tests exercise
these mappings independently of any installed system fonts.

## Fixed failure paths

The Settings host previously accepted a missing stylesheet's HTTP response body
as CSS. The embedder also accepted CSS without any font faces. Separately,
`document.fonts.ready` could resolve after an original font failed to load, and a
failed font embedding promise remained cached for the lifetime of the surface.
Those paths could either render a fallback face or make a transient failure
persist. They were reproduced with controlled fixtures; they are not evidence
that any one of them caused the reported intermittent fresh-load incident.

Settings now checks the stylesheet response, rejects absent or conflicting face
mappings, and awaits successful loads of both physical original outline faces
before taking a snapshot. Failed resource and embedded-font promises are evicted
so later work can retry. A failed document font load reports an error and requires
reopening Settings after the resource problem is resolved; it is never accepted
as a successfully prepared fallback raster.

Family matching follows CSS's case-insensitive family names. Remapping is scoped
to serialized style attributes so literal text such as `font-family:Example;`
in a nickname is preserved. Physical-face deduplication and declared fallback
order remain intact.

The later serialization audit reproduced a separate deterministic failure: the
valid six-character nickname `url(a)` was interpreted as an image resource in
both a text node and an input value. The host's asset-only policy then rejected
that raster. Attribute-looking literal text could also enter the old rewriting
path. Resource discovery now visits actual serialized `src` and `style`
attributes; CSS URLs are recognized outside quoted strings and comments, with
XML entities and CSS escapes decoded only in those resource contexts. Literal
text, form values, unrelated attributes, comments and CDATA remain unchanged.
This fixes a failed Settings update without identifying the cause of the
reported intermittent font corruption.

The fix parses serialized tags once, retains the resource-attribute spans, and
reuses immutable tokenizers. A host-specific Node benchmark used style-heavy
synthetic XML because retained browser snapshots were unavailable. With original
font data and cached resources, median embedding time increased from 3.584 to
4.919 ms for 674,420 bytes, and from 6.134 to 10.141 ms for 2,023,604 bytes
(seven rounds of 30 embeds after warmup). These measurements describe the
correctness overhead of a full embedding operation, not browser navigation,
Country performance or GPU work. Existing raster-cache hits and accepted
image-only hover patches do not run the embedder.

Regressions cover delayed stylesheet and font readiness, missing or failed faces,
empty and conflicting CSS, case-insensitive aliases, literal page text, transient
font-fetch recovery, resource-like nicknames, escaped image/background URLs, and
reuse of a successfully embedded font. Run them with:

```sh
node --test web/tests/settings-bridge.test.js \
  web/tests/settings-raster-bridge.test.js \
  web/tests/settings-performance.test.js
```

## Follow-up cold-load and child-frame audit

The follow-up resource audit resolved all seven font-family declarations in the
prepared original Settings CSS, including its misdecoded legacy names, to the
16 exported aliases. No missing or conflicting source CSS family was found.
The Home Menu manifest still has seven aliases for three physical bitmap faces
and 135 glyph sheets; the IPL subset contains 91 mapped characters and each
shared face contains 7,361. The menu waits for bitmap loading before scene
initialization, and Settings waits for the original outline readiness promise
before serialization. No glyph rendering or source font mapping was changed.

A resource-backed cold-load regression constructs all bitmap aliases, holds
their image decodes independently, and completes the 135 physical sheets in
reverse order. It verifies one decode/allocation per sheet, rejects readiness
while one sheet is pending, and checks that each alias retains the texture for
its own source sheet after completion. Existing controlled failure tests verify
decode and upload rejection, shared callers, cleanup and successful retries.
These tests exercise async ownership with the actual descriptors, not browser
image decoding or GPU output.

A separate Settings failure was reproduced: a child frame's original-font
readiness error was dropped by its parent frameset. The parent then waited for
a child raster without reporting why it was unavailable. The raster bridge now
relays errors from its own child windows and retires that child's previous
snapshot. A later sibling raster cannot be combined with stale failed-child
pixels; a successfully reloaded child restores the composite normally. The
regression also rejects error messages from unrelated windows. This change is
limited to failure handling and adds no work to normal glyph drawing.

The focused font/readiness/renderer set passes 46 tests. Run the additional
bitmap loading checks with `node --test web/tests/renderer-load.test.js`.
Neither this race fixture nor the child-frame failure reproduced the reported
intermittent wrong or garbled lettering. Actual browser cold-load evidence and
a failing capture are still needed; the original incident remains open.

The continuation audited every font reference in the prepared original layouts.
All active USA bindings resolve. The only absent names are the Chinese and Korean
alternatives in the shared keyboard text-box layout, whose language groups the
current USA keyboard explicitly hides. That is a regional coverage boundary,
not evidence of an intermittent USA face swap. No new asynchronous bitmap-font
ownership defect was established. The serialization fix was verified with
controlled module regressions; its visual browser check remains pending because
the local browser automation surface was unavailable during that audit.

## Browser evidence and remaining gap

An isolated in-app Settings inspector opened successfully, and a fresh reload
produced a completed first-page raster with readable original lettering and no
browser warnings or errors. The reload reported 172.7 ms to first raster ready;
this is a single local observation, not a performance guarantee or a native
comparison. No existing user settings or prepared assets were deleted.

The specific reported intermittent Home Menu/Settings corruption has not been
reproduced. A failing capture with its loaded descriptor identities and request
outcomes is still needed to identify that incident conclusively. Matched native
captures remain necessary to assess outline rasterization fidelity. The fixes
above establish explicit load validation and recovery behavior, not 1:1 font
rendering or proof that every source of intermittent corruption is resolved.
