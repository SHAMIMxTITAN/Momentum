# Momentum

A personal tracker for the three things that otherwise live in my head: what I plan to buy,
what I have to do today, and what leaves my bank account every month.

Single user, local-first, no account, no server. It runs entirely in the browser, stores
everything in `localStorage`, and — if you want two devices to agree — syncs through a
private GitHub repo you own.

Built for myself. Public because the sync design and a few of the interaction details might
be useful to someone building something similar.

```bash
npm install && npm run dev     # vite, binds to your LAN so a phone can open it
npm run build                  # static output in dist/, relative paths
npm test                       # 60 tests, no framework — node --test over the pure logic
```

## The three tabs

**Buy** — one ordered list. Position *is* the priority; there's no separate order field to
fall out of step. Items sit under Now / Soon / Later / Maybe, and dragging one across a
section header is what changes its urgency. Each carries a kind (Need / Both / Want) and a
free-text tag you make up as you go. Ticking something off feeds the Spending tab.

**To-do** — Today, Tomorrow and This week. Today is split into three bands behind a
switcher — Daily habits, Namaz, and one-off Tasks — showing one at a time with counts on the
other tabs, so the day doesn't read as one long list of obligations. Tomorrow rolls into
Today when tomorrow actually arrives. A task left in This week for a full week gets flagged.

**Spending** — Upcoming and Spent. Upcoming lists monthly subscriptions in the order they
hit the account, with the amount that has to stay in the bank over the next few days; each
can be ticked off once paid, which moves it to next month rather than clearing it. Spent is
a month-by-month history derived from what you marked as bought.

## The parts worth reading

**GitHub as a sync backend, with real conflict handling.** Three JSON files in a private repo
you own — list, tasks, payments. Every save is a commit, so nothing is ever truly lost and
the history is inspectable with tools you already have. The interesting part is
`decide(localJson, remote, base)` in [`src/github.ts`](src/github.ts): a three-way compare
against the last state that synced cleanly. Without that base you cannot tell "I edited"
from "they edited", so anything ambiguous returns `conflict` and the UI *asks* instead of
silently picking a winner. No CRDT, no server, no merge daemon.

**Recurring things are derived, never reset.** A daily task is done only if its `doneAt`
falls on today's local calendar day, so it reopens every morning with no timer, no reset
pass, and no stored "last reset" date to drift or disagree between two devices. A
subscription's billing day comes from the date you started it, so a stored date can't go
stale after the first cycle — and a month too short for the day bills on its last, the way
card issuers do.

**The pure logic is separated and tested.** Sync decisions, drag-and-drop reordering across
section boundaries, date rollovers, month-length arithmetic and every parser live in
[`src/store.ts`](src/store.ts) as pure functions, covered by 60 tests that need no DOM and no
test framework — just `node --test` over TypeScript directly via Node's type stripping.

**Everything untrusted is parsed at the boundary.** `localStorage` and imported files are
both attacker-controlled as far as the app is concerned, so each `parse*` function rebuilds
its type from scratch, whitelists enums and colours, and drops anything it doesn't recognise.
Links go through `safeUrl`, which exists because a `javascript:` URL in an imported file
would otherwise run on click.

## Syncing between two machines

The data lives in a **private** repo separate from this one. Nothing in this repository
contains or has ever contained a token.

1. Make a private repo. It can be empty — the files are created on first save.
2. Create a **fine-grained** personal access token at
   <https://github.com/settings/personal-access-tokens/new>:
   - Repository access → **Only select repositories** → the repo from step 1
   - Permissions → Repository permissions → **Contents: Read and write**
   - Nothing else. Set an expiry you're happy to renew.
3. In the app, **Sync** at the bottom of the Buy tab → `owner/repo`, the file name, the token
   → **Connect**.

It pulls on open and whenever the window regains focus, and pushes 1.5 seconds after your
edits settle. If both machines moved since the last clean sync, it asks which to keep; the
version you don't keep is still in the repo's commit history.

**On the token:** it sits in that browser's `localStorage`, unencrypted. Anyone with your
unlocked machine — or anything that can run script on the page — can read it. That is why it
should be fine-grained and scoped to the one data repo: worst case, someone edits your
shopping list. Don't use a classic token, and don't grant it anything beyond Contents.

## Installing it as an app

It's a PWA — manifest, icon, and a small service worker that precaches by parsing
`index.html` for the content-hashed asset filenames, so there's no stale-cache trap.

Deploy `dist/` anywhere over **https** (a PWA won't install over plain http, except on
`localhost`), then use the browser's Install action. On iOS, Share → Add to Home Screen.

## Stack

React 19, TypeScript, Vite 7, Tailwind v4 (no config file — the Vite plugin handles it),
`@dnd-kit` for dragging, `framer-motion` for row transitions, `lucide-react` for icons.
About 4,000 lines of source.

[`HANDOFF.md`](HANDOFF.md) is the engineering log: the design decisions, the reasons behind
the non-obvious ones, and the mistakes already paid for so they don't get rediscovered.

## Licence

MIT — see [LICENSE](LICENSE).
