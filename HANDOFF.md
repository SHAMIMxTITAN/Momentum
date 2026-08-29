# Handoff — Momentum

Personal "what to buy next" app. Single user, local-first, no login. Built in a previous
session; this file is the context for continuing it.

## Commands

```bash
npm run dev          # vite, port 5173, binds to LAN
npm run build        # -> dist/, relative paths, static deploy anywhere
npm test             # node --test src/store.test.ts  (38 tests, all passing)
npx tsc --noEmit     # typecheck
```

## Stack

Vite 7 + React 19 + TypeScript + Tailwind **v4** (via `@tailwindcss/vite` — there is no
`tailwind.config.js` and none is needed), `@dnd-kit`, `framer-motion`, `lucide-react`.

## Files

- `src/App.tsx` — the whole UI. Three tabs (Buy / To-do / Spending), rows, sections, quick add,
  inline edit, chips, totals, sync panel.
- `src/store.ts` — types, localStorage hook, undo stack, generic `buildRows`/`applyDrag`,
  `parseItems`/`parseTodos`, `monthlySpend`, `safeUrl`.
- `src/theme.ts` — `useTheme`: system / light / dark, toggles `.dark` on `<html>`.
- `src/github.ts` — GitHub Contents API sync + `useGitHubSync` + the pure `decide()` function.
- `src/store.test.ts` — tests for reorder, migration, spending, sync decisions, URL sanitizing.
- `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg`, `public/icon-192.png` — PWA.
- `README.md` — user-facing setup (token scopes, deploy, install).

## How it works

- **Order is priority.** There is no `order` field; the array index *is* the order.
- **Kind + a free tag.** v1's fixed `category` (Repair/Gear/Lego/Clothes/Want) is gone. An item is
  `kind: 'Need' | 'Both' | 'Want'` plus an optional free-text `tag` the user types. `KINDS` is
  ordered as a spectrum (essential → discretionary) and the row pill cycles through it in that
  order; `Both` is the genuinely-needed thing bought in a nicer form than strictly required, and
  it is deliberately its own column in `monthlySpend` rather than folded into either side.
  `parseItems` migrates old files: the old category name survives as the tag. Don't reintroduce
  a fixed list.
- **Paging.** The three tabs are one native CSS scroll-snap row (`snap-x snap-mandatory`,
  one full-width `snap-start` section each). The browser does the finger-tracking, the
  throw velocity and the snap, so there is no animation code and no touch maths — an
  earlier hand-rolled touchstart/touchend version was a jump cut and also hijacked swipes
  meant for the tag chip row. **Scroll position is the source of truth**; `onScroll` only
  mirrors it into `tab` so the header can highlight one, and the header sits outside the
  scroller. Each page scrolls vertically on its own (`h-dvh` column + `min-h-0 flex-1`),
  which is what stops a short page inheriting a tall one.'s height. **Any inner
  horizontal scroller needs `overscroll-x-contain`** or reaching its end chains the rest
  of the gesture to the pager and flips the page.
- **Sections.** Items group into Now / Soon / Later / Maybe. The section headers and the "Nothing here"
  ghosts are themselves members of the dnd-kit sortable list — that is what makes dragging
  across a boundary reassign `urgency`. `applyDrag` re-reads each item's urgency from the
  header above it after the move. Don't "simplify" the headers out of the sortable list.
- **To-dos** show one day at a time (Today / Tomorrow / This week) behind a big switcher, rather
  than all three stacked. Today gets the whole screen; a one-line peek underneath looks at the
  next bucket so tomorrow can warn you without taking space. `importance()` decides what appears
  in that peek — a hand-starred task always wins, then wording (`SIGNALS`), then shouting. It
  never reorders anything; list position stays the user's call. Drags reorder within the shown
  day via `reorderVisible`, and the chevron on a row moves it to the next day.
- **Must payments** are recurring monthly commitments (subscriptions, rent), a separate list from
  items — they are never "bought", they just come round again. They head the Spending tab and are
  styled deliberately unlike everything else: a dark slab stating the monthly floor, then a plain
  ledger with no cards, pills or drag, because these are commitments rather than choices.
  `groupPayments` totals them and buckets by a free-text `group`; a paused row stays listed but is
  excluded from every total, and an ungrouped one falls into "Other".
- **Wave gauges.** `WaveBox` fills a rounded box from the bottom with a drifting surface: two
  paths 1200 units wide inside `overflow-hidden`, each drifting a whole number of its own
  periods on a CSS keyframe so the loop is seamless. **The viewBox is 600 wide and the front
  period is 300, so exactly two S-curves are on screen at any box width** — the card is
  max-width capped at 592px, so the horizontal scale is always ≤1 (measured 0.987 from 1280px
  to 1920px viewports, 0.53 at 375px). Two mistakes were made here in order, and both read as
  "the gauge is broken" rather than as a geometry bug:
  **Faceting.** Béziers are flattened into line segments in *user* units, so a viewBox narrower
  than the rendered box magnifies those segments into a visibly jagged edge. The 100-wide
  viewBox was a 5.9× crush and looked pixelated. *Never let the horizontal scale exceed 1.* An
  even earlier 300-wide viewBox in a ~100px box turned the sine into seven visible bumps.
  **Slideshow.** One wave — or two identical ones at different speeds — is a rigid shape sliding
  sideways, and does not read as animation however slow it is. The fix is two waves that
  *disagree*: different wavelength (300 vs 200) and opposite directions, so crests overtake and
  cancel and the surface keeps changing shape. Amplitude must be visible too — ~5px in a 52px
  box. The old "amplitude ≈ a fiftieth of the wavelength" rule was an overcorrection that
  flattened the wave to 2.6px, which is what made it look like a sliding bar.
  The level is a CSS *transition* off `@starting-style`, so it rises from empty on mount and
  still lands at the right height when animation is off; it rides a `--bn-lvl` custom property
  because an inline `transform` would outrank the starting style and kill the rise. All of it is
  decorative — `prefers-reduced-motion` kills it and the reading
  stays correct. The three kind gauges fill by **share of that month**, so they always sum to a
  full month and need no configuration; the only gauge with a real ceiling is the optional
  monthly budget (`buy-next.budget`, local, 0 = unset), which is green, amber past 80% and red
  over. Spending has no natural limit, so never invent one — if unset, offer to take a number.
- **Spending** is derived, never stored: `monthlySpend` buckets bought items by the month of
  `boughtAt`, splits Need/Want, and breaks each month down by tag. Items bought before `boughtAt`
  existed land in an "undated" bucket rather than being dropped.
- **Storage.** `localStorage` keys: `buy-next.v1` (items), `buy-next.todos.v1` (tasks),
  `buy-next.payments.v1` (monthly commitments), `buy-next.theme`, `buy-next.sync`
  (token/repo/path), and one base per synced file: `buy-next.synced`, `buy-next.synced.todos`,
  `buy-next.synced.payments` (last-synced `{sha, json}` — the base for three-way compare).
- **Sync.** Three files, not one: the list at `cfg.path`, tasks at `todosPath(cfg.path)`, and
  monthly payments at `paymentsPath(cfg.path)` (`list.json` → `list.todos.json`,
  `list.payments.json`). `useFileSync` is generic over a single file — adding another list means
  adding one `FileSync` entry. The list file stays a bare JSON array on purpose — folding
  tasks into it would parse as empty on a machine still running v1 and push that emptiness back.
  Pull on open + on window focus; debounced push 1.5s after edits settle.
  `decide(localJson, remote, base)` returns `up-to-date | take-remote | push-local | conflict`.
  Both sides changed => `conflict`, and the UI **asks** rather than picking a winner. There is
  deliberately no per-item merge (would need deletion tombstones -> a small CRDT).

## Gotchas already paid for — don't rediscover these

- **dnd-kit and framer-motion must not share a DOM element.** Both write `transform`. `ItemRow`
  is a plain outer div (dnd-kit's transform) wrapping a `motion.div` (exit animation, which
  animates only non-transform props). Merging them breaks dragging.
- **`npm test` runs the TS directly via Node's type stripping.** Imports in the test's dependency
  chain need explicit `.ts` extensions (`allowImportingTsExtensions` is on in tsconfig).
  `tsconfig.json` excludes `src/**/*.test.ts` so `tsc` doesn't want `@types/node`.
- **Service worker precaches by parsing `index.html`** for the hashed `/assets/` filenames. Don't
  replace this with a hardcoded list — the hashes change every build.
- Tailwind v4: no config file, colors are inline `style` or arbitrary values like `bg-[#F5F5F7]`.

## Visual rules

Minimal, flat: **no borders, no shadows heavier than `shadow-sm`, no gradients, no
glassmorphism**. System font stack. Kind pills are **solid filled, white text**: Need `#007AFF`,
Both `#30B0C7`, Want `#AF52DE`; the free tag is a quiet neutral pill beside it. Urgency headers are quiet 12px uppercase `--muted` labels with a 6px colour dot (they were 20px semibold in the accent colour until 2026-08-29 — four saturated headers over mostly-empty sections read as loud, not premium). The dot keeps the signal:
Now `#FF3B30`, Soon `#FF9500`, Later `#8E8E93`, Maybe `#5E5CE6`. Springy ~200ms motion, respect
`prefers-reduced-motion`. No sidebars, no logo header.

**Colours come from CSS variables in `index.css`** (`--bg`, `--card`, `--card-2`, `--field`,
`--text`, `--muted`, `--faint`, `--ghost`), swapped by `.dark` on `<html>`. Never hardcode a
surface hex in a component — accent colours (the iOS palette above) are the only literals.

Three rules from the original brief were **deliberately overridden** by the owner on 2026-08-16,
so don't "restore" them: dark mode now exists (system-following with a manual toggle); tabs now
exist (Buy / To-do / Spending); Lucide is used for the theme toggle as well as grip/check/delete.
Spacing was also tightened throughout — headers 26px→20px, rows and section gaps reduced —
because the original layout read as too empty.

## State: verified vs not

Verified: 24/24 tests; typecheck clean. **Live GitHub round-trip now works** — push, pull, and
first-run-on-a-clean-machine were all exercised against `SHAMIMxTITAN/buy-next-data` on
2026-08-16. In the browser: add with price/kind/tag, all four urgency sections, tag filter chips,
mark-bought feeding the Spending view, month grouping and tag breakdown, to-do add and sections,
dark/light computed colours, and no horizontal overflow at 375px.

**Not verified:**

1. **Live OS theme switching.** `useTheme` resolves correctly on load, but the preview browser
   changes `prefers-color-scheme` without dispatching `change` events (a plain listener fired
   0 times), so the live-update path is untested. Real Chrome does fire it.
2. **Still no screenshots, and animations still cannot be tested.** `requestAnimationFrame` fires
   **zero** times in the preview pane (measured, 2026-08-16), so Framer Motion never advances:
   exit animations never complete and `AnimatePresence` holds removed rows mounted forever. A row
   that appears stuck after being ticked off or moved is that artifact, not a bug — real Chrome
   fires rAF. Don't "fix" it based on what the preview shows; check in a real browser first.
3. **Conflict resolution against a real repo.** The conflict bar's UI path has never fired live;
   only `decide()` is unit-tested. Same for the new to-do file's conflict path.
4. **Touch drag on a real phone.** Driven only with synthetic pointer events.
5. **PWA install.** Needs an https deploy; only localhost was checked.

## Suggested next steps

1. Deploy `dist/` over https (Cloudflare Pages / Netlify / Vercel work with a private repo free;
   GitHub Pages needs a public repo on a free plan — keep the *data* repo separate and private).
2. Get the laptop onto the new code before using it — v1 there will not understand `kind`/`tag`
   and would rewrite the list file with migrated-away data.
3. Force a conflict on purpose with junk data and confirm the bar appears for both files.
4. Look at it and give visual notes — this still has never been seen.
5. Test touch drag on the phone at the LAN URL `npm run dev` prints.
