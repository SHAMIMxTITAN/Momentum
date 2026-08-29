---
name: get
description: Get the latest changes from GitHub - pull, install, test, run. Use when the user says /get, "get the latest", "pull the changes", "I'm starting work", or wants changes made on the other machine brought onto this one.
---

Bring this machine up to date with GitHub. Follow these steps in order.

1. Check for uncommitted local changes first.
   - If there are any: **STOP**. Show them to the user. Do not discard, stash, or
     overwrite their work. Ask what they want to do.
2. Run `git pull`.
3. If there are merge conflicts: **STOP**. Name the conflicting files and ask the user.
   Do not resolve them unilaterally.
4. Run `npm install` - dependencies may have changed since they last worked here.
5. Run `npm test` and `npx tsc --noEmit`. Report the results.
   Expect 38 passing tests and a clean typecheck.
6. Start the dev server and give the localhost URL.

**Hard rules**

- Never change application code during this skill.
- Never discard uncommitted work to make the pull succeed.
- If already up to date, say so plainly and still do steps 4-6.

Report back in short bullet points, plain language. Explain any technical term used.
