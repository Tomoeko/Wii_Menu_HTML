# Public-source privacy checks

Original WADs, executable instructions, extracted dictionaries, keys, fonts,
graphics, sound data, local messages and native recordings belong in ignored
private or generated directories. Public source contains the importers and
controllers. The optional dictionary worker reads the user's prepared executable
and dictionaries locally; its PowerPC guest has no operating-system services,
host filesystem calls or network access. Browser dictionary requests use the
same-origin local server. Neither memos nor dictionary queries are sent to an
external service.

Channel Manager also uses only the local server. Uploaded custom packages remain
in ignored `.local/custom-channels/`; validated installed resources go into ignored
`web/public/assets/custom-channels/`. Authoring errors returned to the page omit
host filesystem paths. Show/Hide writes `config.json`, so review local channel IDs
and visibility choices before committing that configuration. Recoverable deletion
writes only ignored `.local/channel-trash.json`; it retains original resources and
source packages. Tool appearance stores only System/Light/Dark in browser-local
storage. Images, GIF frames and audio are processed locally without remote
conversion services.

Run the authored-text audit from the project directory:

```sh
npm run audit:privacy
```

After preparing assets, also inspect generated text metadata:

```sh
npm run audit:privacy -- --assets
```

The audit reports file names, line numbers and match categories without echoing
matched private text. It checks home-directory paths, the local personal username
and symlinks requiring explicit review. It excludes `.local`, `artifacts`,
dependency directories and binary resources. A passing result does not establish
that all secrets, copyrighted material, console identifiers or unintended
network behavior have been found.

Before publishing, inspect the exact staged file list and diffs. Confirm that
private/generated directories remain ignored, no original resource binaries or
user data are staged, and documentation identifies inputs by logical name and content hash
instead of personal paths. Review dependency and network behavior separately.
The authored custom-channel sample WAV is reproducible from its included generator;
keep that provenance distinct from extracted or uploaded audio.
Retain the public common-key policy in the development guide; cosmetic encoding
of a public constant is not a security boundary. Complete the remaining release
acceptance items in the local, untracked `ROADMAP.md`.
