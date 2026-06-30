# Assets needed before the first build

`expo prebuild` references these image files (declared in `app.json`). Drop them
in here before building (you can reuse/export from the Android app's brand mark):

| File | Size | Purpose |
|---|---|---|
| `icon.png` | 1024×1024 | App icon (no alpha, no rounded corners — Apple rounds it) |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon foreground |
| `splash.png` | ~512×512 | Splash logo on `#0B0A14` background |

Until these exist, the build will fail at prebuild. They are intentionally not
checked in as placeholders (a blank PNG would ship a blank icon).
