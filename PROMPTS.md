# Copy-paste prompts

Two prompts for moving code between the laptop and the PC.

- Changed something and want to keep it? → **Prompt A** on that machine.
- Sitting at the other machine and want the changes? → **Prompt B** there.

Rule of thumb: **A** when you finish working, **B** before you start.

(The shopping list itself syncs on its own. These are only for the app's code.)

---

## Prompt A — Save my changes to GitHub

Run this on the machine where you made the changes.

```
Save my work to GitHub.

1. Show me `git status` and tell me in plain language what changed.
2. Run `npm test` and `npx tsc --noEmit`. If either fails, STOP and tell me what
   broke. Do not commit broken code.
3. Stage everything and commit. Read the actual diff and write a short message
   describing what really changed - don't guess from the filenames.
4. Push to origin/main.
5. Confirm it landed and give me the link.

If the push is rejected because the other machine pushed first, STOP and tell me.
Do not force push. Do not rewrite history.

Report back in short bullet points.
```

---

## Prompt B — Get the latest changes

Run this on the machine that needs the changes.

```
Get the latest changes from GitHub.

1. Check for uncommitted local changes first. If there are any, STOP and show them
   to me - do not discard, stash, or overwrite my work.
2. Run `git pull`.
3. If there are merge conflicts, STOP and tell me which files. Don't resolve them
   yourself.
4. Run `npm install` - dependencies may have changed since I last worked here.
5. Run `npm test` and `npx tsc --noEmit` and tell me the results.
6. Start the dev server and give me the localhost URL.

Do not change any application code.

Report back in short bullet points.
```

---

## If something goes wrong

**"Push rejected"** — the other machine pushed first. Run Prompt B, then Prompt A again.

**"Merge conflict"** — both machines changed the same line. Don't guess; paste the
file names into a Claude session and ask it to sort them out.

**Forgot to pull before working** — not fatal. Run Prompt A; if it's rejected,
run Prompt B, then A again.
