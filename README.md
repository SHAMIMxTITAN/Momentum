# Buy Next

One ordered list of things to buy. The order is the priority.

```bash
npm install && npm run dev
```

Static build (outputs to `dist/`, relative paths so it works from any subfolder):

```bash
npm run build
```

Tests for the drag/reorder, sync-decision, and input-parsing logic:

```bash
npm test
```

## Syncing the list between two machines

The list is stored as a single JSON file in a private GitHub repo. Both machines read and
write that one file, so whichever you pick up has the current list. Every save is a commit,
so nothing is ever truly lost.

**Setup, once per machine:**

1. Make a private repo (e.g. `you/buy-next-data`). It can be empty — the file is created on
   first save.
2. Create a **fine-grained** personal access token at
   <https://github.com/settings/personal-access-tokens/new>:
   - Repository access → **Only select repositories** → the repo from step 1
   - Permissions → Repository permissions → **Contents: Read and write**
   - Nothing else. Set an expiry you're happy to renew.
3. In the app, click **Sync** at the bottom, enter `owner/repo`, the file name, and the token,
   then **Connect**.

**How it behaves:** pulls on open and whenever the window regains focus; pushes 1.5s after
your edits settle. If both machines changed the list since the last sync, it does *not* pick a
winner — it asks, and the version you don't keep is still in the repo's commit history.

**On the token:** it lives in this browser's `localStorage`, unencrypted. Anyone with access to
your unlocked machine (or anything that can run script on the page) can read it. That's why it
should be fine-grained and scoped to the one data repo — worst case, someone edits your
shopping list. Don't use a classic token, and don't grant it anything beyond Contents.

## Installing it as a desktop app

The app is a PWA: a manifest, an icon, and a small service worker so it opens offline.

1. Deploy `dist/` anywhere over **https** (a PWA won't install over plain http, except on
   `localhost`). Cloudflare Pages / Netlify / Vercel all work with a private repo on a free
   plan. GitHub Pages also works, but on a free account Pages requires a **public** repo —
   fine for the app code, just don't put the data file in that same repo.
2. Open the URL in Edge or Chrome on each machine → address-bar **Install** icon (or ⋯ → Apps
   → Install). You get a real window, a taskbar icon, and no browser chrome.
3. Updates: push a new build and it lands on next launch. `index.html` is fetched
   network-first, and the JS/CSS filenames are content-hashed, so there's no stale-cache trap.

## Notes

- Data also lives in `localStorage` under `buy-next.v1`; Export/Import JSON still works and
  needs no token.
- Position in the list *is* the priority; there's no separate order field to get out of sync.
- Drag across a section header to change an item's urgency.
- Tap the coloured pill to cycle its category. Click the title to edit title/price/note/link
  (and delete).
- Cmd/Ctrl+Z undoes the last delete or bought action.
- `npm run dev` binds to your LAN, so a phone on the same wifi can open the Network URL vite
  prints.
