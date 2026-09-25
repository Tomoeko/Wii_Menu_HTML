# Local NAND import and extraction

The importer reads supplied NAND files without changing them. It runs locally
using Python's standard library and the application's existing Node.js runtime.
Node's built-in AES implementation communicates through private process pipes;
keys never enter command-line arguments, logs, temporary files or browser assets.

## Supported input and integrity checks

- Extracted directories containing `title/`.
- BootMii Wii images of 553,648,128 bytes: 262,144 pages, each with 2,048 data
  bytes and 64 spare bytes. The matching 1,024-byte `keys.bin` is required.
- BootMii images of 553,649,152 bytes with the same pages and an appended key
  footer. An explicit key override takes precedence over a footer.
- Directories containing exactly one image of either supported size.

The reader authenticates the newest SFFS metadata block and every extracted file
cluster using NAND HMAC-SHA1. Either of the two stored HMAC copies may authenticate
a cluster. A wrong key or damaged authenticated content fails the operation.
It validates filesystem node bounds, node revisits, portable filenames, duplicate
paths, cluster ownership, chain bounds and chain lengths before extraction.

The format hypotheses were checked against the supplied binary dump: all 390
files, totaling 309,047,115 bytes, passed metadata and file-cluster HMAC validation.
Two repeated, double-input imports of the same sample produced exactly 13 unique
managed channels and retained the saved layout. The verification used temporary
private directories and did not alter the configured browser assets.

For extracted directories, an available `title.tmd` selects the active banner
content and its TMD-sized payload must match the SHA-1. A longer file is
accepted only when the entire suffix is zero; its original padding is preserved. Without a TMD, exactly one banner-bearing
content per title is accepted. That compatibility path has no original NAND HMAC
to verify. This does not verify Nintendo certificate signatures.

Hardware ECC repair, spare-free flash images, other NAND geometries and Wii U
images are unsupported. The newest metadata generation is selected numerically;
generation counter wraparound is not supported. Damaged newest metadata fails
explicitly instead of silently rolling back to an older filesystem state.

## Install channels in one command

```sh
npm run prepare -- --wad /path/to/menu.wad --nand /path/to/nand.bin
npm run prepare -- --rebuild --nand /path/to/extracted-nand --nand /path/to/another/nand.bin
npm run prepare -- add --nand /path/to/nand.bin --nand-keys /path/to/keys.bin
npm run prepare -- plan --nand /path/to/newer-nand
npm run prepare -- add --nand /path/to/newer-nand --replace-channel 0001000148414241
```

The System Menu WAD remains required for preparing the menu itself. Raw channel
import extracts title content, optional title metadata and the channel layout
into scoped private scratch space. Only selected channel resources, each original TMD, allocation accounting and
the saved layout are retained for rebuilds; the raw NAND's other user data and keys are not installed.

Title IDs identify channels. By default, existing imports win over repeated NAND
inputs and distinct title IDs are added. Use repeatable `--replace-channel ID`
to select individual NAND replacements, or `--nand-policy replace` to replace
all installed IDs present in the supplied NAND. Repeatable `--keep-channel ID`
overrides that bulk policy and also skips a new title. Both flags reject IDs not
present in the supplied NAND. An explicitly removed title stays excluded until
its ID is chosen with `--replace-channel`. Explicit channel WADs can also replace
an existing title. Existing browser arrangement configuration is preserved, and
the first usable original layout is kept as the default layout.

`plan` reads one NAND without installing it and reports title IDs, available TMD
versions, active banner and TMD SHA-256 hashes, and whether each title is new,
unchanged, different or previously removed. A missing TMD version remains unknown. For a
reviewed command-line selection, save that JSON and pass `--expect-plan FILE` to
`add`; import rejects the operation if the NAND or installed channel comparison
has changed before publication. The [Channel Manager](channel-management.md)
uses the same guard for its visual comparison. It stages only active icon and
banner resources for previews; the source NAND and keys stay local.

Replacing a title originally imported from a WAD switches the active descriptor
to the selected NAND content. The old decrypted WAD cache under `.local/titles/`
is retained as private data; it is no longer referenced by that title.

Preparation stages resources, new imported content and state. It publishes only
after conversion succeeds. A private `.local/.prepare-transaction.json` journal
records the exact scratch directories before they are created, then the owned
replacement paths before any publication. Original files remain in backups until
all replacements and the commit marker have been written. The journal, staged
files and filesystem renames are flushed in order where supported.

The next preparation or `list` operation automatically recovers an interrupted
run **before reading its state**. An uncommitted run restores the previous assets,
imported resources and preparation state; a committed run retains the complete
new generation and finishes cleanup. Recovery itself can be interrupted and
retried. Existing browser placements and configuration are not replaced. Normal
completion, handled failure and successful recovery leave no transaction scratch
directories, journal or preparation lock.

If a process was killed, run the original command again or use the following
recovery-only inventory command. Keep the same `--local-dir` and `--output` values
if the interrupted command used custom directories:

```sh
npm run prepare -- list
```

Do not manually remove the journal, backups or `.prepare-lock` file: these protect
the last complete generation. A malformed journal, changed output target or
symlink in an owned recovery path fails without discarding recovery data. Custom
channel installation/repair and permanent deletion use the same publication
exclusion path. They leave an interrupted preparation's lock untouched until
preparation recovery completes. Directory locks left by older versions or other
local operations are retained conservatively; they are not mistaken for a dead
preparation's OS-held file lock.

Child-process tests cover process interruption. They do not establish atomic
visibility to unrelated readers during the brief sequence of filesystem renames,
or durability across arbitrary filesystem corruption or hardware power failure.
The tests run on the local macOS filesystem. Windows uses the standard-library
MSVCRT lock and a delete-sharing file handle; Windows directory flush behavior
and live crash recovery have not been validated on this host.

## Channel size accounting

Channel detail blocks use source allocation metadata, not banner length. In the
USA 4.3 binary, `0x8134CD68` requests usage for the entire title `content/`
directory in 16,384-byte clusters and adds the optional `meta/.../title.met`
length rounded up to one cluster. `0x813A8DC8` converts that result to
`ceil(allocatedBytes / 131072)` for the detail pane. This includes the TMD and
stale files and verified zero padding still present in the content directory;
title save data and shared
content outside that directory are excluded. Empty files consume zero data
clusters. Directory inodes do not add data clusters to this display count.

New NAND imports record that accounting before retaining only the banner and
original TMD. Their private preparation descriptor stores versioned `storage`
metadata; the catalog receives only validated sizes, counts, method and TMD hash,
plus the resulting `blocks` and `paddedContentCount`. It contains no source host paths or save contents.
The method is `nand-directory-allocation`. Original resources remain unchanged.
WAD imports use `wad-install-estimate`: cluster-rounded non-shared TMD contents
plus the TMD itself. The explicit estimate cannot describe pre-existing stale
files or a separately installed `title.met` on a console.

A rebuild upgrades older full NAND directories or WAD imports by reading their
existing sources. Repeating a NAND import may fill missing accounting only if
its active banner and any retained TMD exactly match; existing channel content,
other metadata and placement still win. A banner-only import without complete
source accounting leaves the block count unavailable and adds a catalog warning.
Reimport the complete source to supply it. Missing source sizes are never guessed
from the banner. Existing known accounting survives source removal and rebuilds.

The supplied Internet Channel's full content directory accounts for 222 clusters,
which produces 28 blocks and agrees with the fresh native detail observation.
This is one checked title, not a claim that all storage branches are measured
identically. Free NAND/SD capacity remains an explicit local fixture value; the
current 905-block default is not a measurement recovered from the imported NAND.
No free-capacity value is derived from these per-title counts.

The catalog also retains the two original IMET title fields as
`titleLines[language]`, while joined `title`/`titles` remain compatible with the
main menu. This lets detail panes show a real second line instead of fabricating
or flattening one.

## Extract without installation

```sh
python3 tools/assets/nand.py /path/to/nand.bin --output /path/to/new-extraction
python3 tools/assets/nand.py /path/to/nand.bin --keys /path/to/keys.bin --output /path/to/new-extraction
```

Extraction refuses an existing destination. It publishes the resulting directory
only after every file authenticates, including empty directories and files. It
does not copy `keys.bin`. Extracted NAND contents can contain private console and
user data; keep the destination in private local storage.

## Regression coverage

`npm run test:assets` includes public synthetic fixtures for AES-CBC known-answer
vectors and streaming, separate and embedded keys, damaged data and wrong keys,
path traversal, cyclic metadata, truncated chains, unsupported geometry,
destination preservation, active-content TMD hashes, additive duplicate-safe
imports, source independence, retained removals and publication rollback. Separate
preparation tests terminate child processes before staging, between each resource
and state replacement, after commit, and during recovery/cleanup. They verify
restoration or retention of a complete generation, preserved user placements,
clean retries, first-install recovery, active-writer exclusion and safe rejection
of invalid recovery paths.

The completed pipeline was also checked with the supplied USA 4.3 WAD after
journal integration. An active rebuild retained all 13 imported channel
descriptors and the exact user placement, configuration and Trash files. Its
`auto` audio mode retained `original-menu-emulated-ax-capture` BGM and added the
original sequence package plus the built-in approximate reverb effect renders.
An isolated WAD-only preparation with `--background-source builtin` produced 71
audio entries with `original-sequence-built-in-dry-approximate` BGM: 4,438,848
frames at 32 kHz, loop markers 71.454–138.714 seconds and PCM WAV SHA-256
`044c5156d1779181fef0c6022ed889fae766ecc963814550a1824950429b9f9c`.
Both successful runs removed their journals, locks and transaction scratch;
the isolated verification directory was then removed. These source modes remain
explicit because built-in synthesis is not a claim of native AX equivalence.

The format investigation consulted the original reverse-engineering notes in
[WiiBrew's NAND layout](https://wiibrew.org/wiki/Hardware/NAND) and
[BootMii dump format](https://wiibrew.org/wiki/Bootmii/NAND_dump_format), and then
validated the relevant offsets and HMAC construction against the supplied dump.
No external extraction project is a runtime dependency.
