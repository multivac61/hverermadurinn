# hverermadurinn

Daily Icelandic guessing game built with SvelteKit.

## Stack
- SvelteKit + Tailwind
- Cloudflare Workers adapter
- Nix dev shell
- Bun package manager
- Drizzle ORM + Drizzle Kit (D1 schema/migrations)
- Valibot (runtime request validation)

## Development

```bash
nix develop
bun install
bun run dev
```

## Build

```bash
bun run build
```

## Database (Drizzle + D1)

Generate SQL migrations from TypeScript schema:

```bash
bun run db:generate
```

Apply migrations locally:

```bash
bun run db:migrate:local
```

Apply migrations remotely:

```bash
bun run db:migrate:remote
```

## Current status
- Round lifecycle with Iceland timezone logic (`12:00` open, `17:00` close)
- D1-backed game state (sessions, questions, guesses, leaderboard)
- Deterministic daily person selection with per-round persistence in D1
- Question flow (`max 20`), one-time hint, and reveal flow
- Typeform-like single-page UI prototype in Icelandic
- Valibot validation on server input payloads
- SvelteKit remote functions for client↔server game actions
- Remote-function-first app surface (legacy `/api/*` routes removed)

## Admin
- Route: `/admin`
- Uses remote functions + `ADMIN_TOKEN` check
- Set a real token in Cloudflare Workers env vars before deploy

## LLM integration (ready)
Set secret/API settings in Cloudflare:

```bash
bunx wrangler secret put LLM_API_KEY
```

And in `wrangler.toml` vars (already added):
- `LLM_PROVIDER` (`gemini`, `openai`, `openai-compatible`, or `kimi`)
- `LLM_MODEL`
- optional `LLM_BASE_URL` for OpenAI-compatible providers

## Local testing mode (no waiting)
Create `.dev.vars` from `.dev.vars.example` and run with `wrangler dev`.

Useful flags:
- `FORCE_ROUND_OPEN=true` → bypasses 12:00–17:00 restriction
- `DEV_RANDOM_ROUND_PER_SESSION=true` → each new session gets random round/person seed

In UI, dev mode shows a button: **"Ný random prófunarlota"**.

## Notes
Current app path uses remote functions and D1 when `DB` binding exists.
Next step is model-backed answering (Gemini/Kimi adapter).
