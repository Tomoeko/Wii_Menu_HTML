# Supplied WAD resource inventory

These counts describe the local USA System Menu 4.3 WAD used for verification, not a requirement imposed on every version. Preparation discovers archive contents and exports available packages. It does not require the reference repository's NAND dump.

| Input content | Browser export | Scope |
| --- | --- | --- |
| Menu resource U8, `layout/common/*.ash` | 32 packages, 116 BRLYT layouts, original textures and BRLAN curves | Channel grid, preview shell, pointer, HOME, health, Wii Options, settings transitions, Message Board, calendar, letters, memory/data screens, keyboard |
| `layout/<language>/homeBtn1.ash` | Selected locale merged into common HOME package | Original language-specific HOME artwork |
| `html/US2/iplsetting.ash` | 758 decompressed files; English/French/Spanish entry points | Original Opera settings HTML, scripts, CSS, and artwork; local bridge inserted into derived HTML, raw HTML retained |
| `message/<language>/ipl_common.bmg` | Seven languages with 458 indexed messages each | Original message strings, newlines, and opaque control packets |
| Shared bitmap font content | Rodin/Utrillo RFNA atlases, 7,361 characters each | Native NW4R text metrics and glyphs, registered original aliases |
| `WiiNTLG-Regular.ttc` | Two browser TTF faces, raw split faces, and CSS | Original proportional/fixed-width glyphs and metrics; only the invalid U+FFFF missing-glyph sentinel is normalized for modern browser validation, with repair metadata and hashes |
| `sound/IplSound.brsar` | Menu effects, drag loop, built-in BGM rendering | Original samples and sequence timing; approximate effect mix/envelopes from the shared built-in sequence renderer; supplied native BGM capture may be preserved |
| Additional channel WADs / optional NAND | Channel BRLYT/BRLAN/TPL, IMET titles/flags, sound WAVs | Separate channel applications are optional; a menu WAD alone gives a Disc-only catalog |

The pipeline validates WAD title matching, AES content decryption, and every TMD SHA-1. It does not verify certificate signatures. Individual channel resources additionally validate IMD5 wrappers where present. Resource source hashes remain in generated metadata; no keys appear in public manifests.

Export coverage is broader than runtime implementation. Presence of original settings or Message Board assets does not imply hardware services, network operations, installed-title execution, or every transition is emulated. The browser implements its own local bridges and state adapters; native channel startup/idle branches are documented separately in [CHANNEL_SCRIPTS.md](CHANNEL_SCRIPTS.md). Rendered frame/audio comparisons are needed to establish fidelity for a specific behavior.

Original HTML backups, font files, recordings, and PNGs are generated local resources and are excluded from the source distribution. The repository contains parser/exporter code and synthetic tests only.
