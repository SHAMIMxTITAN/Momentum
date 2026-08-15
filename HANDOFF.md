# Handoff — Buy Next

Personal "what to buy next" app. Single user, local-first, no login. Built in a previous
session; this file is the context for continuing it.

## Commands

```bash
npm run dev          # vite, port 5173, binds to LAN
npm run build        # -> dist/, relative paths, static deploy anywhere
npm test             # node --test src/store.test.ts  (14 tests, all passing)
npx tsc --noEmit     # typecheck
```

## Stack

Vite 7 + React 19 + TypeScript + Tailwind **v4** (via `@tailwindcss/vite` — there is no
`tailwind.config.js` and none is needed), `@dnd-kit`, `framer-motion`, `lucide-react`.

## Files

- `src/App.tsx` — the whole UI. Rows, sections, quick add, inline edit, chips, totals, sync panel.
- `src/store.ts` — types, localStorage hook, undo stack, `buildRows`/`applyDrag`, `parseItems`, `safeUrl`.
- `src/github.ts` — GitHub Contents API sync + `useGitHubSync` + the pure `decide()` function.
- `src/store.test.ts` — tests for reorder, sync decisions, URL sanitizing. Run with `npm test`.
- `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg`, `public/icon-192.png` — PWA.
- `README.md` — user-facing setup (token scopes, deploy, install).

## How it works

- **Order is priority.** There is no `order` field; the array index *is* the order.
- **Sections.** Items group into Now / Soon / Later. The section headers and the "Nothing here"
  ghosts are themselves members of the dnd-kit sortable list — that is what makes dragging
  across a boundary reassign `urgency`. `applyDrag` re-reads each item's urgency from the
  header above it after the move. Don't "simplify" the headers out of the sortable list.
- **Storage.** `localStorage` keys: `buy-next.v1` (items), `buy-next.sync` (token/repo/path),
  `buy-next.synced` (last-synced `{sha, json}` — the base for three-way compare).
- **Sync.** Pull on open + on window focus; debounced push 1.5s after edits settle.
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

## Visual rules (non-negotiable, from the original brief)

White `#FFFFFF` background. Cards `#F5F5F7`, `rounded-2xl`, **no borders, no shadows heavier
than `shadow-sm`, no gradients, no glassmorphism, no dark mode**. System font stack. Category
colours as **solid filled pills, white text**: Repair `#FF3B30`, Gear `#007AFF`, Lego `#FF9500`,
Clothes `#AF52DE`, Want `#34C759`. Urgency headers 26px semibold: Now `#FF3B30`, Soon `#FF9500`,
Later `#8E8E93`. 16px padding in rows, 12px between rows, ~32px between sections. Springy
~200ms motion, respect `prefers-reduced-motion`. Lucide icons only for drag handle, check,
delete. No sidebars, no tabs, no logo header.

## State: verified vs not

Verified: 14/14 tests; typecheck and build clean; computed styles and geometry match the rules
above at 375px and 1280px; totals math; cross-section drag; bought/undo/filter/inline-edit;
service worker registers and precaches the shell on first load; manifest valid; a bad token
surfaces "Token rejected".

**Not verified:**

1. **Live GitHub round-trip.** `pull`/`push`/conflict have never talked to a real repo — only
   the pure `decide()` logic is unit-tested, plus a 401 rejection. First real Connect is the test.
2. **No visual review ever happened.** Screenshots were impossible in the previous session
   (browser pane never composited, so `requestAnimationFrame` never fired). Nobody has looked at
   this app. Framer Motion animations are entirely unexercised as a result.
3. **Touch drag on a real phone.** Driven only with synthetic pointer events.
4. **PWA install.** Needs an https deploy; only localhost was checked.
5. **Not a git repo yet.** `git init` before deploying.

## Suggested next steps

1. `git init`, commit, push to GitHub.
2. Deploy `dist/` over https (Cloudflare Pages / Netlify / Vercel work with a private repo free;
   GitHub Pages needs a public repo on a free plan — keep the *data* repo separate and private).
3. Connect sync on machine #1, add an item, confirm the commit lands. Then machine #2, confirm
   it pulls. Then edit both while offline and confirm the conflict bar appears.
4. Look at it and give visual notes — this has never been seen.
5. Test touch drag on the phone at the LAN URL `npm run dev` prints.
