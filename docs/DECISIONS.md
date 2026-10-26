# Decisions log

## 2026-10-26

**Backdated entries are supported.**
Why: when travelling or otherwise away, entries get missed and need to be logged later.
Detail: an optional date prefix (`yesterday`, `on 20 oct`) sets `occurredAt`. Grammar finalized in M1.
Future dates are rejected as ambiguous (nothing written).

**Omitted account means ask, no default account.**
Why: a silent default risks writing to the wrong account. Hard rule 7 (ambiguous input writes nothing)
already covers this. The bot replies with a clarifying question listing known account aliases.

**Channel is Telegram.**
Why: avoids Meta's test-number token expiry and webhook verification friction. `core` stays
channel-agnostic, so WhatsApp can be added later as another adapter.
Note: Telegram verifies webhooks with the `X-Telegram-Bot-Api-Secret-Token` header
(constant-time compare), not `X-Hub-Signature-256`. Sender allowlist is the numeric Telegram user id.

**Dashboard auth is Better Auth + Google OAuth with an email allowlist.**
Why: no password handling, single user, free. Non-allowlisted Google accounts are rejected at sign-in
and every server-side data read re-checks the session.

## 2026-10-26 (M0 tooling)

**TypeScript pinned to 6.0.3, not 7.**
Why: typescript-eslint 8.72 refuses to load under TS 7.0 (peer range `<6.1.0`). TS 7.0 ships no stable
compiler API; a new one is expected in 7.1. Revisit when typescript-eslint supports TS 7.1+.
No other installed package declares a TS peer range that blocks 7. Our tsconfig already typechecked
under 7.0.2; when upgrading, add `"types": ["node"]` where Node types are needed (TS 7 defaults `types` to `[]`).

**Prisma pinned to 7.10.1 (CLI and client), not `latest`.**
Why: the npm `latest` tag is 8.0.0-rc, a release candidate. Prisma 7 keeps the datasource URL in
`packages/db/prisma.config.ts`, not in `schema.prisma`. M0 schema has no models.

**Prettier plus eslint-plugin-import-x import ordering.**
Why: requested. `import-x/order` groups builtin, external, internal, relative, type, alphabetized,
blank line between groups. Prettier ignores `*.md` and `.claude/` so spec and agent docs are not reflowed.

**ESLint blocks db, adapter, AWS, prisma, network and fs imports inside `packages/core`.**
Why: enforces the "core is pure" layout rule mechanically.

**pnpm build scripts approved only for prisma, @prisma/*, esbuild, unrs-resolver; workerd denied.**
Why: pnpm 12 blocks install scripts by default. workerd arrives transitively via the Prisma CLI and is not needed.

**Vitest root config lists projects explicitly (`packages/core` only for now).**
Why: projects without tests fail startup config. Add each package when it gets tests.
