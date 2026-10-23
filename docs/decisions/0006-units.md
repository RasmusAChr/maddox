# 0006 — Units: upright, typed with Ctrl+U, converted with →

**Status:** accepted, 2026-10-23. The owner chose the recommendation on all
four questions.

## Problem

`5 m/s` was read as 5 times the variables m and s. Units have to stay
apart from variables (m is also mass, or the slope in y = mx + b), convert
(72 km/h to m/s), and fail clearly when they don't fit (5 m + 3 s).

## What other programs do

- TI-Nspire: an underscore marks a unit (`5_m`), ▸ converts.
- Mathcad, SMath: known unit names are units unless a variable of that
  name is defined.
- Qalculate, Numbat: plain words, `72 km/h to m/s`.
- GeoGebra, Desmos: no units.
- Textbooks and ISO 80000: units upright (m), variables in italics (*m*).

## Decision

1. **A unit is upright.** Ctrl+U (also Ctrl+P "Type a unit") starts unit
   mode: letters typed are a unit, `/` stays inline (km/h), `*` is a ·
   between units, `^2` a power. Space, Esc or Ctrl+U ends it; any other
   operator ends it too. The sidebar has a Units category. In the file a
   unit is `\mathrm{km/h}`.
2. **→ converts**: `72 km/h → m/s` is 20 m/s. An arrow followed only by
   units is a conversion; `(x, y) → x + y` stays a function.
3. **Results** show a named SI unit when they are exactly one
   (3 kg · 9.81 m/s² is 29.43 N, 2 A · 3 Ω is 6 V), otherwise the units as
   they combine (m², m/s). Units that cancel disappear (5 m / 1 m is 5).
4. **Temperatures convert only** (added 2026-10-23). `°C` and `°F` are
   units typed in unit mode (Ctrl+U, then `°C`; Ctrl+P also has them).
   `20 °C → °F` is 68 °F, `0 °C → K` is 273.15 K, `300 K → °C` is 26.85 °C.
   Any other use (`20 °C + 5 °C`, `2 · 20 °C`, a bare `20 °C`) is an error
   telling the student to convert, or to calculate in K. Why: the scales
   have an offset, so adding or scaling them is not physics, and Giac's
   `convert` can't do it. Options B (absolute temperatures with K
   differences) and C (treat °C like any unit) were considered; B can grow
   from this. °F results stay exact (`100 °F → °C` is 340/9), °C ↔ K uses
   the decimal offset 273.15.

## Consequences

- Temperatures: the converter reads `°C`/`°F` (also `\degree C`, `^\circ C`) in
  an upright group as `_degC`/`_degF`; `conversion` turns `n °C → °F` into
  `maddox_temp(n,"C","F")`. The session defines `maddox_temp`, which
  returns `maddox_degC(x)`/`maddox_degF(x)` (drawn by `temperatureLatex`)
  or a real K unit. Any `_degC` left over is the error above.

- Converter: `\mathrm{…}` is a unit (`unitToGiac`), except `\mathrm{d}`
  (the d of dx) and an upright name before brackets (a call). `conversion`
  turns a trailing `-> units` into `convert(…)`.
- Session: `unknownUnit` checks each name (Giac accepts any `_name`),
  `tidyUnits` cancels and names units, `unitLatex` draws the unit itself.
- Giac and MathLive traps: `docs/gotchas.md`.
