# Custom channel template

This original sample uses colored panes and the menu's prepared font. It contains
no extracted Nintendo artwork or executable channel code. `sound.wav` is an
original five-note composition generated locally from sine oscillators by
`tools/custom-channel-audio.mjs`: 32 kHz stereo, 16-bit PCM, 2.4 seconds.
The included waveform uses no existing recording, sample bank or music track.

Edit `channel.json` for the identifier and hover label. Edit the `Title` text pane
in both layouts for the visible title. The installer uses the existing renderer's
pane, material and animation schema. Coordinates are centered; positive Y is up.

Run these commands from the repository root:

```sh
node tools/channels.mjs validate /path/to/this-directory
node tools/channels.mjs add /path/to/this-directory
```

Reload the menu or open `/inspect.html?channel=custom-my-channel&kind=banner`.
Use the identifier from your `channel.json` if you changed it.

See `docs/custom-channels.md` in the project for images, sound, animation keys,
aspect adjustment, updates and removal. Keep this source directory: generated
browser assets are not a replacement for your authoring files.

The icon repeats a 180-update rotation. The banner fades/slides in over 30 updates
and retains a separate 180-update loop. Sound starts through the menu's ordinary
preview audio lifecycle. Start is a dummy boundary, as for imported channels.

`init` creates an independent copy and regenerates the same sound bytes:

```sh
npm run channels -- init ~/MyChannel --id custom-my-channel --title "My Channel"
```

You can replace `sound.wav` with your own PCM WAV and edit `channel.json` to change
loop points or remove audio. Keep backups of authored resources before editing.
