# Design system

Written before the first screen was built. Everything the interface draws comes from the
tokens below; nothing hard-codes a colour, a size or a shadow.

The goal from brief §36 is a product that reads as considered rather than assembled: strong
typographic hierarchy, restrained colour, real empty states, and charts that have to justify
their existence.

## Principles

1. **Type carries the hierarchy, not colour.** Weight and size separate levels. Colour is
   reserved for meaning.
2. **One accent.** A single burnt orange marks the current thing, the primary action and the
   first item in a ranking. Everything else is a neutral.
3. **Numbers are the subject.** Metrics are set large, tabular-aligned and unadorned.
4. **A chart must add information.** Where a ranked list with bars says it better, the list wins.
5. **Empty and error states are designed, not defaults.** Both name the next action.
6. **Density without noise.** Hairline rules instead of boxes; one shadow level, barely there.

## Colour

Tokens are RGB triples so opacity can be applied at the point of use. Both themes are
defined explicitly; the viewer's system preference decides, and the toggle overrides it.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--surface` | `250 250 249` | `12 10 9` | Page background |
| `--surface-raised` | `255 255 255` | `28 25 23` | Cards, panels |
| `--surface-sunken` | `245 245 244` | `20 18 16` | Inputs, code, wells |
| `--border` | `231 229 228` | `41 37 36` | Hairlines |
| `--border-strong` | `214 211 209` | `68 64 60` | Interactive edges |
| `--ink` | `28 25 23` | `245 245 244` | Primary text |
| `--ink-muted` | `87 83 78` | `168 162 158` | Secondary text |
| `--ink-subtle` | `105 98 93` | `152 146 140` | Labels, metadata |
| `--accent` | `180 60 11` | `251 146 60` | Active state, primary action |
| `--positive` / `--negative` | `21 128 61` / `185 28 28` | `74 222 128` / `248 113 113` | Deltas only |
| `--chart-1…6` | see `styles.css` | | Categorical series |

**Every foreground/background pair meets WCAG 2.1 AA (4.5:1) in both themes.** This is
checked, not assumed: the `--ink-subtle` and `--accent` values were adjusted after an audit
found 4.40:1 and 3.65:1 respectively, and the axe run in the end-to-end suite fails the
build on any critical or serious violation.

## Type

System sans throughout; monospace only for paths, models, identifiers and code.

| Token | Size | Used for |
| --- | --- | --- |
| `text-2xs` | 11px | Labels, metadata, evidence lines |
| `text-xs` | 12px | Table cells, list rows, help text |
| `text-sm` | 13px | Body, section headings |
| `text-lg` | 16px | Card titles in the profile |
| `text-xl` | 20px | Page titles |
| `text-2xl` | 26px | Metric values |
| `text-3xl` | 36px | Profile distribution figures |

Numeric columns use `font-variant-numeric: tabular-nums` so figures line up down a column.

## Space, shape, depth

- Spacing follows Tailwind's 4px scale. Card padding is `20px`; section gaps are `24px`.
- Radii: `4px` inputs, `6px` buttons, `8px` cards. Nothing is fully rounded except status dots.
- Two shadows only: `--shadow-card` (a hairline lift) and `--shadow-pop` (tooltips, panels).
- Borders do the work shadows usually do.

## Motion

- 200ms fade-and-rise on content arrival; 500ms width transition on bars and progress.
- Charts animate once on mount.
- Everything is disabled under `prefers-reduced-motion: reduce`, including Recharts.

## States

Every data surface implements four states deliberately:

| State | Treatment |
| --- | --- |
| Loading | Shimmer skeletons shaped like the content that follows — never a spinner |
| Empty | Icon, one-line explanation, and a real call to action |
| Error | Plain sentence, "Try again", and technical detail behind a disclosure |
| Offline | Named as "the local analytics service is unavailable", with the same disclosure |

## Charts

Recharts, wrapped in `components/charts/primitives.tsx` so axes, tooltips, colour and motion
are consistent. Three types are enough: an area trend, a column chart, and a donut used only
where a part-to-whole comparison is genuinely the point.

Every chart is paired with a **Show data** toggle that swaps it for the same numbers as a
table. That is what makes the charts usable with a screen reader, and it is often the faster
way to read them.

## Navigation

A single top bar. No sidebar, no nested menus, no breadcrumbs. Nine destinations, each one
noun. Filters live in the URL, so any view can be linked or reloaded exactly as it was.
