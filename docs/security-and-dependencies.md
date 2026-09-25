# Dependency and supply chain audit

This review covers the maintained source tree as of September 24, 2026. The
application and its local preparation tools use browser APIs, Node.js built-in
modules and Python's standard library. `package.json` has no dependency maps,
there is no npm lockfile or tracked `node_modules`, and the only remaining
Python requirements file declares no package. HTML entry points load local
scripts and styles. The native capture workflow can launch a user-supplied
Dolphin executable, but Dolphin is not imported into this project.

## Install behavior

The project [disables npm lifecycle scripts](https://docs.npmjs.com/cli/install/)
with `.npmrc`'s `ignore-scripts=true`. `npm start` and `npm run dev` explicitly
run `tools/start.mjs`, which initializes missing local defaults and then starts
the server. Explicit `npm run prepare` still runs the first-party WAD importer.
The public-source inventory includes `.npmrc` and `tools/start.mjs` so an
exported source tree keeps the same startup and install behavior.

The former optional Unicorn-powered dictionary worker and probes were removed.
The browser now uses prepared OEM word lists with an editor-local, first-party
predictor. Original Zi8 ranking and candidate acceptance remain fidelity gaps;
the old execution results in the keyboard notes are historical source analysis.
Reference PNG comparison and capture analysis use `tools/reference/raster.py`,
whose hash is recorded in new reports. Reports produced with other decoders or
resamplers must not be assumed numerically identical.

HTTP CSP sandboxes direct-open WAD Settings HTML and SVG assets; authored pages
disallow inline scripts.

## Worm exposure checked

[GitHub documented](https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/)
the original Shai-Hulud worm's use of malicious npm post-install scripts.
The [2026 TanStack advisory](https://github.com/advisories/GHSA-g7cv-rxg3-hmpx),
[Mini Shai-Hulud advisory](https://github.com/advisories/GHSA-6xwp-cp5h-q856)
and [August Keyv/Cacheable incident](https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack)
describe credential theft, self-propagation and editor hook persistence in later
variants. A source-tree check found no declared affected package, dependency
lockfile, known `setup.mjs`/`Math_Symbol.js`/`math_init.js` or
`tanstack_runner.js`/`router_init.js`/`router_runtime.js` payload filename,
repository `.claude` or `.vscode` execution hook, or active repository Git hook.
There are no tracked CI workflows. This is a repository check, not a forensic
assessment of the developer machine, npm cache or any previously installed
package.

## Routine checks

Run `npm test`, `npm run test:assets`, `npm run test:reference`,
`npm run audit:privacy` and `npm run check` after relevant changes. Keep package
dependency maps empty and use repository-owned code instead of `npx`, CDN
scripts, pip packages or vendored third-party bundles. Review any future
install-time script or remote fetch before it enters an authored workflow.
