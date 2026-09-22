# Wii Menu in HTML

Disclaimer: This project heavily utilizes Codex/ChatGPT.

A local browser reconstruction of the Wii System Menu. Console services are represented by local dummy behavior where needed.

## License

The authored source and documentation are released under [Creative Commons Zero v1.0 Universal](LICENSE). Nintendo software, artwork, fonts, trademarks, WADs, NAND data, and other third-party material are not included and remain under their own rights.

## Run

Requirements: Node.js 20+ and Python 3.10+.

Provide your own System Menu WAD.

```sh
npm run prepare -- --wad /path/to/menu.wad
npm start
```

Open <http://127.0.0.1:5173/>. Generated files and private inputs stay in ignored `.local/` and `web/public/assets/` directories.

## Channels

Open <http://127.0.0.1:5173/channels.html> to manage installed channels.

```sh
npm run prepare -- --wad /path/to/menu.wad --channel-wad /path/to/channel.wad
npm run prepare -- --rebuild --nand /path/to/nand
npm run channels -- list
npm run channels -- add --wad /path/to/channel.wad
npm run channels -- install /path/to/custom-channel-one /path/to/custom-channel-two
npm run channels -- overwrite /path/to/custom-channel-one /path/to/custom-channel-two
npm run channels -- remove CHANNEL_ID custom-channel-folder
```

Custom channel packages can be created with:

```sh
npm run channels:custom -- init ~/MyChannel --id custom-my-channel --title "My Channel"
npm run channels:custom -- add ~/MyChannel
```

## Configuration and controls

Edit [config.json](config.json), then reload. It controls display ratio, audio, startup behavior, Wii Remote fixtures, SD-card fixtures, and channel layout.

- Point and click the menu. Tab and Enter expose keyboard-accessible controls.
- Home or H opens HOME. Escape or Backspace returns. M toggles mute.
- Hold the middle or right mouse button to move channels and Memo cards.

Prepared audio is the default. To rebuild it from the imported WAD:

```sh
npm run prepare -- --rebuild --background-source builtin
```

## Dictionary

The prepared WAD exports local word lists. They provide dictionary suggestions
without third-party packages. An optional Unicorn runtime can execute the
original Zi8 code for closer ordering:

```sh
python3 -m venv .local/dictionary-runtime
.local/dictionary-runtime/bin/python -m pip install -r tools/dictionary/requirements.txt
```

The runtime is local and optional. Text entry and word suggestions still work without it.

## Checks

```sh
npm run check
npm test
npm run test:assets
npm run audit:privacy
```

## Layout

- `web/src/` — browser renderer and scene controllers
- `web/tests/` — JavaScript tests
- `tools/assets/` — WAD import and resource conversion
- `tools/reference/` — optional capture and comparison tools
- `docs/` — focused technical notes
- `.local/` and `web/public/assets/` — ignored local state and generated assets
