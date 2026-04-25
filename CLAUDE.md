# CLAUDE.md — Operating Instructions for Claude Code

This file is read automatically at the start of every session.
It defines how Claude operates in this project and all future projects built by jpgyap.

---

## Core Philosophy: Automate First

**Never give manual instructions when Claude can do it directly.**

Before telling the user to run a command, deploy, click a button, or configure something:
1. Check available MCP tools — can Claude do it?
2. Check available CLI tools — can Claude run it via Bash?
3. If neither: identify exactly which API/connection is missing, ask for it once, then do it

```
❌ "Run `vercel --prod` to deploy"
✅ Deploy directly via Vercel MCP or Vercel CLI

❌ "Go to Supabase and run this SQL"
✅ Execute via mcp__supabase__execute_sql

❌ "Set the Telegram webhook manually"
✅ Call the Telegram API directly via fetch
```

If Claude cannot automate something, it states exactly what connection is missing and asks the user to add it — then does the task immediately once access is granted.

---

## Session Start Protocol

At the start of every session:

1. Read `claude/agents.md`, `claude/skills.md`, `claude/workflow.md`
2. Check available MCP tools (`mcp__supabase__*`, `mcp__vercel__*`, etc.)
3. Check `.mcp.json` for configured connections
4. Identify any gaps between what's needed and what's available
5. If a gap exists and it's relevant to today's work, ask for the connection upfront

---

## Session End Protocol

Before ending any session where code was written or bugs were fixed:

1. **Check for new learnings** — Was there a bug fixed? A new pattern used? A gotcha hit?
2. **Update the guides** — Add it to the relevant file in `claude/`
3. **Update the Lessons Learned table** in `claude/workflow.md`
4. **Commit the guide updates** with message: `Update claude/ guides — [what was learned]`

This is non-negotiable. The guides must grow with every session.

---

## Automation Capability Map

Check this before giving any manual instruction:

| Task | Tool Available | How |
|---|---|---|
| Deploy to Vercel | ✅ Vercel MCP or CLI | `mcp__vercel__*` or `vercel --prod` |
| Run SQL on Supabase | ✅ Supabase MCP | `mcp__supabase__execute_sql` |
| Query Supabase tables | ✅ Supabase MCP | `mcp__supabase__list_tables` |
| Push to GitHub | ✅ Bash | `git push origin main` |
| Set Telegram webhook | ✅ Bash (fetch) | Direct API call |
| Check Vercel logs | ✅ Vercel MCP | `mcp__vercel__*` |
| Create Supabase tables | ✅ Supabase MCP | `mcp__supabase__execute_sql` |
| Read/write files | ✅ Built-in | Read, Edit, Write tools |
| Search code | ✅ Built-in | Grep, Glob tools |
| Create cron on cron-job.org | ❌ No MCP yet | Ask user to add cron-job.org API |
| Send Telegram message directly | ❌ No MCP | Use fetch via Bash |

When a row shows ❌, say:
> "I need access to [service] to do this automatically. Can you add the MCP or API key?"
> Then provide the exact command or config to add it.

---

## API Access Request Pattern

When Claude hits a capability gap, it should:

1. State what it's trying to do
2. State what's missing
3. Provide the exact command to fix it
4. Wait for confirmation, then execute immediately

```
Example:
"I need to create the cron job on cron-job.org to fire /api/reminders every minute.
I don't have API access yet. Add it with:

  claude mcp add croncron https://api.cron-job.org/mcp --scope project

Once connected, I'll set it up automatically."
```

---

## Self-Improvement Rules

### After fixing a bug
→ Add to Lessons Learned table in `claude/workflow.md`:
```
| [bug description] | [root cause] | [fix] |
```

### After discovering a new pattern
→ Add to the relevant section in `claude/agents.md` or `claude/skills.md`

### After a new app is built
→ Add any new skill categories, stack combinations, or architecture patterns

### After a deployment issue
→ Update the deployment checklist in `claude/workflow.md`

### After a new MCP tool is connected
→ Add it to the Automation Capability Map above

---

## Code Quality Rules

- No comments explaining WHAT the code does — names do that
- No backwards-compatibility shims for removed code — just delete it
- No error handling for impossible cases — only validate at system boundaries
- No half-finished implementations — ship complete or don't ship
- Prefer editing existing files over creating new ones
- Test the golden path before reporting done

---

## Stack Reference (this project)

| Layer | Tech |
|---|---|
| Hosting | Vercel (Hobby — daily crons only) |
| DB | Supabase (PostgreSQL) |
| AI | Claude Sonnet (`claude-sonnet-4-6`) |
| Bot | Telegram Bot API |
| Timezone | PHT (UTC+8) — all times converted from UTC |
| Runtime | Node.js ESM → compiled to CJS by Vercel |

See `claude/agents.md`, `claude/skills.md`, `claude/workflow.md` for full patterns.
