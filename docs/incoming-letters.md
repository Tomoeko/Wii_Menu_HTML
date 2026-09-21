# Local incoming Letter imports

Incoming Letters are explicit local fixtures. The importer validates their text,
sender and optional PNG photo, then adds them to `.local/message-board.json`.
It never contacts Nintendo, WiiConnect24 or the sender. Reload the menu after an
import; an already-open Board does not receive new records automatically.

Create a version 1 fixture with at most 200 incoming records:

```json
{
  "version": 1,
  "letters": [
    {
      "kind": "letter",
      "id": "example-incoming-letter",
      "createdAt": "2026-01-02T03:04:05.000Z",
      "header": "Example sender",
      "text": "A locally imported Letter.",
      "sender": {
        "kind": "email",
        "address": "sender@example.invalid",
        "nickname": "Example"
      },
      "photo": null
    }
  ]
}
```

```sh
node tools/incoming-letters.mjs import .local/incoming.json
```

Letter IDs use 1–64 ASCII letters, digits, underscores or hyphens. The reserved
IDs `__proto__`, `constructor` and `prototype` are rejected. Text is limited to
1,023 UTF-16 units; a photo-only Letter may have empty text. Headers allow at
most 256 units. Sender nicknames allow at most ten units. A Wii sender address
contains 16 digits; an email sender uses the same local validation as outgoing
Letters. These are local fixture bounds, not a claim that every original
delivery format or message class is implemented.

`sender` must be present. An explicit `"sender": null` represents a Letter with
no reply address; its reader has no Reply control. With a valid sender object,
optional `"replyAllowed": false` also removes Reply while preserving that
sender. Only Boolean values are accepted. Omission keeps the existing replyable
behavior for records with a sender; explicit `true` is normalized away so older
records retain their canonical shape. `sender: null` with `replyAllowed: true`
is invalid. These fields are immutable imported content, so changing an already
imported record's reply permission requires a distinct Letter ID.

This models the native `permit_reply` predicate at `0x81395E94`: a nonzero
address type and a clear no-reply flag are both required. It does not enable
network delivery or arbitrary CDB imports. The original footer uses a separate
Back/Trash sequence when Reply is absent; see the
[reader contract](local-letters.md#incoming-fixture-presentation-contract).

The Board keeps its version 1 `memos` array. Imported entries additionally retain
`kind`, `header`, `sender`, `photo` and an explicit false `replyAllowed` when
provided. New imports start with `readAt: null` and
no saved card position. Reimporting the same ID with identical content preserves
the existing `readAt` and `position`. Conflicting immutable content or a collision
with a Memo rejects the complete import. The Board's combined limit remains
2,000 records. Unknown fixture fields are discarded rather than published.

## Photos

Place each PNG in one explicitly supplied directory, named `<photo.id>.png`.
Replace a record's `photo: null` with metadata like this, using the real hash and
dimensions of the PNG:

```json
{
  "id": "example-photo",
  "width": 512,
  "height": 256,
  "localSrc": "/assets/local-letters/example-photo.png",
  "sha256": "REPLACE_WITH_64_LOWERCASE_HEXADECIMAL_DIGITS"
}
```

```sh
shasum -a 256 .local/incoming-photos/example-photo.png
node tools/incoming-letters.mjs import .local/incoming.json --photos .local/incoming-photos
```

Only PNGs with dimensions from 1×1 through 512×456 are accepted. The importer
uses the existing image decoder to verify PNG chunks, checksums, decompressed
scanline lengths and row filters, and then checks dimensions and SHA-256 against
the descriptor. Each PNG is limited to 4 MiB, and a batch's unique photos to
32 MiB. Fixture JSON is limited to 2 MiB. External URLs, path components in IDs,
symlinked photo files and symlinked output directories are rejected.

Checked bytes are published only to
`web/public/assets/local-letters/<photo.id>.png`. Identical existing assets are
reused; different bytes under the same ID are rejected. No input paths or extra
metadata are copied into the public descriptor. Keep inputs under `.local/` or
another private directory. Both `.local/` and prepared browser assets are ignored
by Git. Their contents remain private local data even though the loopback server
can display the prepared PNGs.

## Writes, conflicts and recovery

Imports acquire the shared `.local/.prepare-lock` before publishing assets, then
the Board's `message-board.json.lock` before reading and merging its current
state. Ordinary server and CLI Board writes use the same Board lock. Photos are
published without replacing an existing file; the complete validated Board is
written to a temporary file, synced and renamed only after the assets exist.

Invalid input, malformed existing Board data and foreign locks leave saved
records unchanged. A failed state write or interrupted import can leave a
validated but unreferenced PNG. A matching retry reuses it. The importer does
not delete such files, remove a foreign lock or repair corrupted JSON. Retain
a backup and investigate any interrupted writer before manually removing its
lock. A preparation lock file may represent a pending recovery journal; run the
normal preparation recovery rather than deleting that file.

Reader Trash supports explicit local erasure after confirmation; shared images
remain available to other records. Ordinary Board saves can change an imported
Letter's `readAt` and `position`, but cannot introduce or
rewrite its content. They preserve imported Letters omitted from an older
browser snapshot. The older `tools/message-board.mjs import` still replaces the
Memo collection after validation while retaining omitted incoming Letters. Use
the incoming importer, with the photo directory when needed, to restore Letters
onto a different installation. Export the full Board with the existing Message
Board command, and back up the original incoming fixtures and photos separately.

For isolated tests or another installation, the importer also accepts
`--board FILE`, `--assets DIRECTORY` and `--local-dir DIRECTORY`. Point
`--local-dir` at the same private state directory used by that installation's
asset preparation. Paths are explicit local inputs and are never sent to an
external service.
