# AGENTS.md

Guidance for coding agents working in this repo.

## Project snapshot
- App: **Hver er maðurinn?** (SvelteKit + Cloudflare Workers + D1)
- Package manager: **Bun**
- Environment/deps: **Nix flake**
- UI language: **Icelandic**
- Code language: **English**
- Svelte style: **Svelte 5 runes** (no legacy `$:` reactive syntax)

## Must-follow rules
1. Keep UX as a **single-form** flow.
2. Use **remote functions** (`*.remote.ts`) instead of classic API routes unless explicitly asked.
3. Prefer minimal, typed server logic and clear user-visible errors.
4. Do not leak hidden-answer information unless explicitly requested by the user input.
5. Run checks before handoff:
   - `nix develop -c bun run check`
   - `nix develop -c bun run build`

## Local dev
- Fast UI iteration: `bun run dev`
- Cloudflare parity: `bunx wrangler dev --local`

## Svelte MCP usage (required)
Use the official Svelte MCP docs as the source of truth for Svelte/SvelteKit API questions:
- https://svelte.dev/docs/mcp/overview

Agent behavior:
- Prefer MCP docs lookups before introducing framework patterns.
- Verify Svelte 5/runes-compatible patterns.
- Avoid outdated snippets from pre-runes examples.

## Social sharing terminology (for future tasks)
For cross-platform link previews, the correct terms are:
- **Open Graph metadata** (`og:*` tags)
- **Twitter/X Cards** (`twitter:*` tags)
- **OG image** (social preview image, e.g. 1200x630)

When implementing shareable previews, add/verify:
- `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
- `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
