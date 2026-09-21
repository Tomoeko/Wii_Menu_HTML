# Development guide

## Purpose and scope

Build a readable, portable HTML reconstruction of the Wii System Menu. Match
original resources and verified native behavior, including interaction, sound,
animation timing, and draw order. Keep hardware and discontinued network
services as clearly defined local placeholders.

This directory is the maintained project. Documentation must describe this
project and verified sources, without depending on or promoting superseded
implementations.

## Source quality

- Never author minified code. This applies to JavaScript, HTML, CSS, Python,
  configuration, examples, and embedded scripts or styles.
- Use descriptive names and normal multi-line formatting. Avoid dense chains,
  nested ternaries, and multiple unrelated statements on one line.
- Prefer focused modules with explicit inputs and lifecycle ownership. Keep
  extraction, rendering, scene controllers, persistence, and developer tools
  separate.
- Use two spaces for JavaScript, HTML, CSS, and JSON; four for Python. Use
  single-quoted JavaScript strings, semicolons, and a roughly 100-column limit.
- Comments should explain native behavior, non-obvious constraints, or why an
  adaptation exists. Link the specific source function or capture when helpful.
- Format authored JSON with indentation and a final newline. Generated binary
  resources retain their original data; do not hand-edit generated output.
- Do not copy dense generated output into authored source. Format embedded
  bridge scripts and styles as carefully as standalone files.

## Project organization

- `web/src/`: browser renderer, scene controllers, audio, and input.
- `web/tests/`: behavior and regression tests using Node's test runner.
- `tools/assets/`: explicit local WAD/resource preparation and validation.
- `tools/reference/`: reproducible capture and comparison tooling.
- `config.json`: readable user configuration and defaults.
- `defaults/`: tracked initial state files copied to `.local/` on first start.
- `examples/`: tracked channel examples copied to `.local/custom-channels/` on first start.
- `docs/`: architecture, evidence, limitations, and authoring guides.
- `.local/`: ignored user-mutated state, private inputs, and prepared resources.
- `web/public/assets/` and `artifacts/`: ignored generated resources and evidence.

Keep user-facing instructions in `README.md`. Local planned work may be kept in
the untracked `ROADMAP.md`; it is not part of a public source export. Avoid
duplicate implementations and undocumented fallback paths.

## Fidelity and evidence

Use original WAD BRLYT/BRLAN/TPL/BRFNT/BRSAR data, verified binary analysis, and
fresh native captures as oracles. Other projects and decompilations may suggest
questions but cannot establish correctness. Do not cite those projects as source
truth or introduce dependencies on them. Record the
region/version, aspect ratio, source hashes, frame range, and comparison method.
Do not present an approximate sound mix as original AX output or assume every
captured image equals one simulation update.

Separate implemented behavior from measured equivalence. A source-derived
transition still needs aligned native/browser comparisons. Preserve native pane
ownership, animation groups, draw order, hover persistence, and input locking.
Do not substitute arbitrary CSS timing or dimensions for available source data.

## Performance and persistence

Avoid full DOM serialization, image decoding, texture creation, and unrelated
scene updates on every pointer event. Coalesce work, reuse unchanged resources,
and measure representative interaction latency before claiming an improvement.

Use versioned, validated local data with atomic writes. Preserve existing user
data when adding fields. Provide readable files and documented backup/export
paths. Never send local memos, contacts, WADs, or keys to external services.

## Validation

Run `npm test` for changed browser behavior and `npm run test:assets` for
extraction changes. Use focused regressions for timing, isolated animation
state, cancellation, audio lifetime, and persisted data. Exercise the affected
flow in the browser and compare native captures when making fidelity claims.
Avoid tests that merely restate implementation details.

Before delivery, check formatting, console errors, documented limitations, and
the absence of private/generated assets from public source changes. No commit,
deployment, or public release is implied by a local implementation task.

Audit both authored source and exported metadata for personal usernames, home
paths, console identifiers, and private content. Public artifacts identify inputs
by logical role, resource path and content hash; local preparation state may keep
input paths only inside ignored private storage. Public common-key constants are
authorized for the importer with simple cosmetic obfuscation. Never export keys
to browser resources or describe that obfuscation as a security boundary.
