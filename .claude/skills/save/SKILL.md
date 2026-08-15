---
name: save
description: Save my work to GitHub - test, commit, push. Use when the user says /save, "save my work", "push my changes", "I'm done working", or wants their code changes sent to GitHub.
---

Save the user's work to GitHub. Follow these steps in order.

1. Run `git status` and tell the user in plain language what changed. Not filenames -
   what the change actually is.
2. Run `npm test` and `npx tsc --noEmit`.
   - If either fails: **STOP**. Show what broke. Do not commit. Ask if they want it fixed.
3. Stage everything and commit. Read the actual diff with `git diff --cached` and write a
   short message describing what really changed. Never guess from filenames alone.
4. Push to `origin/main`.
5. Confirm it landed and give the repo link.

**Hard rules**

- If the push is rejected because the other machine pushed first: STOP and tell the user
  to run `/get` first, then `/save` again. Never force push.
- Never rewrite history. No `git rebase`, no `--force`, no `reset --hard`.
- If there are no changes to commit, just say so. Don't invent an empty commit.

Report back in short bullet points, plain language. Explain any technical term used.
