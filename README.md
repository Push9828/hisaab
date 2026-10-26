# Hisaab

Chat-driven personal ledger with a dashboard. See `docs/SPEC.md` for the full design.

## Start

```bash
cd hisaab
git init
claude          # Claude Code reads CLAUDE.md and .claude/agents/ automatically
```

First prompt to give Claude Code:

> Read CLAUDE.md and docs/SPEC.md. Use the planner agent to plan M0 (repo scaffold:
> pnpm workspace with packages/core, packages/db, apps/adapter, apps/dashboard; TypeScript
> strict, Vitest, ESLint, GitHub Actions CI running typecheck, lint, test). Show me the plan
> before writing code.

Then M1 (`packages/core`), test-first, using the worked examples in SPEC section 5.

## Before M3

Do the Meta hello-world round trip (developer app, test number, webhook verification)
early. It is the riskiest external dependency. If it fights you for more than an hour,
use the Telegram adapter instead. The core is channel-agnostic by design.
