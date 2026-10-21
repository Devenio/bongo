# buggy-utils 🍌

A tiny library with **planted bugs** for trying Bongo. With the plugin installed, open Claude Code here and say:

> monkey test src/

Spoilers (don't read until Bongo is done):
<details><summary>Planted bugs</summary>

- `slugify` leaves trailing hyphens (`"Hello World!"` → `"hello-world-"`, so its own doc example fails), turns non-Latin titles into `""`, and crashes on `null`
- `parseDuration` silently skips characters it doesn't understand: `"1.5h"` → 5 hours, `"-5m"` → +5 minutes, `"banana"` → 0; huge inputs give `Infinity`
- `formatDuration(0)` (and `0.5`, negatives, `NaN`) returns `""`
- `Cart.total()` drifts off the cent (`19.99 × 5` → `99.94999999999999`); `add` accepts string quantities (`"2"` concatenates), `NaN` prices and negative quantities; re-adding a SKU at a new price keeps the old one
</details>
