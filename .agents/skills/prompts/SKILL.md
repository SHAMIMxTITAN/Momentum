---
name: prompts
description: Show the copy-paste prompts for saving to and getting from GitHub. Use when the user says /prompts, "give me the prompt", "show me the prompts", or wants prompt text to paste somewhere else (another machine, the Codex web app, a fresh session).
---

Print the two prompts below **verbatim**, each in its own fenced code block so the user
gets a copy button. Do not execute them. Do not summarise them. Do not add commentary
between them beyond the short headings shown.

Start with this one line:

> If you're already in Codex, just type `/save` or `/get` instead — no pasting needed.
> These are for pasting somewhere else.

Then output exactly:

**Prompt A — save my changes** (run on the machine where you made changes)

```
Save my work to GitHub.

1. Show me `git status` and tell me in plain language what changed.
2. Run `npm test` and `npx tsc --noEmit`. If either fails, STOP and tell me what broke. Do not commit broken code.
3. Stage everything and commit. Read the actual diff and write a short message describing what really changed - don't guess from the filenames.
4. Push to origin/main.
5. Confirm it landed and give me the link.

If the push is rejected because the other machine pushed first, STOP and tell me. Do not force push. Do not rewrite history.

Report back in short bullet points.
```

**Prompt B — get the latest changes** (run on the other machine)

```
Get the latest changes from GitHub.

1. Check for uncommitted local changes first. If there are any, STOP and show them to me - do not discard, stash, or overwrite my work.
2. Run `git pull`.
3. If there are merge conflicts, STOP and tell me which files. Don't resolve them yourself.
4. Run `npm install` - dependencies may have changed since I last worked here.
5. Run `npm test` and `npx tsc --noEmit` and tell me the results.
6. Start the dev server and give me the localhost URL.

Do not change any application code.

Report back in short bullet points.
```

Then stop. Nothing else.
