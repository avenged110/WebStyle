# WebStyle — development files

The extension itself is in `../WebStyle` (load it via chrome://extensions → Load unpacked).

- `tools/make_icons.swift` — renders the icons: `swift tools/make_icons.swift ../WebStyle/icons`
- `test-harness/run_tests.py` — 43 end-to-end tests (2 need the Stylus backup argument) in a throwaway headless Chromium profile (format,
  Stylus import, live and on-load styling, subdomain precedence, frames, popover buttons, export, import merge).
  Run from `test-harness/`:
  `python3 run_tests.py "$PWD/../../WebStyle" "$PWD/../test-site" "$PWD/../stylus-2026-11-09-12-28.json"`
- `stylus-2026-11-09-12-28.json` — your real Stylus backup, used by the Stylus import tests.
- `test-site/` — test pages (served on a random local port as `*.test`).
