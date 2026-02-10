# Hver er maðurinn? — Technical Architecture (v1)

## 1) Product Summary
Daily Icelandic guessing game:
- A new mystery person is active every day from **12:00 to 17:00 (Iceland time)**.
- Players ask up to 20 yes/no-style questions (one at a time).
- They can guess at any time; one hint is allowed.
- At 17:00 the round closes, the person is revealed, and countdown to next round starts.
- No login; player progress is tracked per device.

---

## 2) Core Requirements

### Functional
1. Daily round lifecycle:
   - `scheduled` (before 12:00)
   - `open` (12:00–17:00)
   - `closed` (after 17:00)
2. One active person per day.
3. Max 20 questions, sequentially.
4. LLM-powered short answers, mostly yes/no.
5. Exactly one hint per device per day.
6. Correct guess handling:
   - reveal image/details
   - allow shareable stats
7. Leaderboard per day (and optional all-time).
8. Basic admin controls to inspect/edit today’s and future rounds.

### Non-functional
- Fast response time (<1.5s target for Q/A when model is fast).
- Timezone correctness for Iceland (`Atlantic/Reykjavik`).
- Minimal abuse protection without login.
- Easy operations from Cloudflare dashboard.
- Privacy-first (no personal account required).

---

## 3) Tech Stack

### Frontend
- **SvelteKit**
- **Tailwind CSS**
- Typeform-inspired single-question flow
- Client-side local persistence (device identity + game state cache)

### Backend/Platform
- **Cloudflare Workers** (SvelteKit adapter)
- **Cloudflare D1** (SQL database)
- **Cloudflare KV** (optional cache/round snapshot)
- **Cloudflare Cron Triggers** (prepare daily rounds)
- **Cloudflare AI Gateway / model provider API** for LLM calls

### Why this fit
- Workers + D1 is simple, globally distributed, and dashboard-manageable.
- Cron + deterministic timezone rules handles open/close lifecycle cleanly.
- SvelteKit remote/server functions align well with app + API in one repo.

---

## 4) High-Level System Design

1. **Client (SvelteKit app)**
   - Fetches current round status.
   - Sends question/guess events.
   - Stores device ID locally.
   - Displays leaderboard/share card.

2. **Game API (SvelteKit server endpoints / remote functions)**
   - Validates round window/time.
   - Enforces question limit and hint usage.
   - Calls LLM orchestrator for question answers.
   - Records attempts and metrics.

3. **LLM Orchestrator (Worker module)**
   - Builds strict system prompt in English (internal), outputs Icelandic short answers.
   - Uses daily person profile as ground truth.
   - Applies output guardrails (yes/no/uncertain + short reason).

4. **Data Layer (D1)**
   - Stores rounds, persons, sessions, events, leaderboard snapshots.

5. **Admin/Operations**
   - Protected admin routes or Cloudflare dashboard scripts for manual edits.

---

## 5) Time & Round Lifecycle

Timezone: `Atlantic/Reykjavik`

- **Before 12:00**: show countdown to open.
- **12:00**: round becomes `open`; questions/guesses accepted.
- **17:00**: round becomes `closed`; reveal person and freeze scoring.

### Lifecycle strategy
- On every request, derive effective status from server time (source of truth).
- Optional cron at 11:55 to pre-warm “today’s round”.
- Optional cron at 17:00 to compute final leaderboard snapshot.

This avoids relying solely on cron reliability for correctness.

---

## 6) Data Model (D1 SQL)

## `persons`
- `id` (text/uuid, pk)
- `display_name` (text)
- `slug` (text unique)
- `description_is` (text)
- `image_url` (text)
- `metadata_json` (text) — tags, aliases, accepted guess variants
- `created_at` (datetime)

## `rounds`
- `id` (text/uuid, pk)
- `date_ymd` (text unique, `YYYY-MM-DD` in Iceland time)
- `person_id` (fk -> persons.id)
- `opens_at_utc` (datetime)
- `closes_at_utc` (datetime)
- `status_override` (text nullable) — optional manual override
- `hint_text_is` (text)
- `created_at` (datetime)

## `device_sessions`
- `id` (text/uuid, pk)
- `device_id_hash` (text)
- `round_id` (fk)
- `started_at` (datetime)
- `question_count` (integer default 0)
- `hint_used` (integer/bool default 0)
- `solved` (integer/bool default 0)
- `solved_at` (datetime nullable)
- `solve_question_index` (integer nullable)
- unique(`device_id_hash`, `round_id`)

## `question_events`
- `id` (text/uuid, pk)
- `round_id` (fk)
- `session_id` (fk)
- `question_text` (text)
- `answer_label` (text) — yes/no/unknown/probably
- `answer_text_is` (text)
- `latency_ms` (integer)
- `created_at` (datetime)

## `guess_events`
- `id` (text/uuid, pk)
- `round_id` (fk)
- `session_id` (fk)
- `guess_text` (text)
- `is_correct` (integer/bool)
- `created_at` (datetime)

## `leaderboard_daily` (optional materialized snapshot)
- `round_id`
- `session_id`
- `rank`
- `guess_count`
- `time_from_start_ms`
- `time_from_open_ms`
- `computed_at`

Indexes:
- rounds(date_ymd)
- device_sessions(round_id, solved, solved_at)
- question_events(session_id, created_at)
- guess_events(session_id, created_at)

---

## 7) API Surface (SvelteKit endpoints / remote functions)

### Public
- `GET /api/round/current`
  - returns status, open/close times, reveal data if closed

- `POST /api/session/start`
  - creates/returns device session for current round

- `POST /api/question`
  - body: `{ sessionId, question }`
  - validates open window + max 20
  - returns `{ label, answerTextIs, questionCountRemaining }`

- `POST /api/guess`
  - body: `{ sessionId, guess }`
  - returns correct/incorrect and reveal payload if correct/closed

- `POST /api/hint`
  - one-time hint per session/round

- `GET /api/leaderboard?date=YYYY-MM-DD`

### Admin (protected)
- `POST /api/admin/round`
- `POST /api/admin/person`
- `POST /api/admin/assign-person`

---

## 8) LLM Answering Strategy

### Prompt contract
- System prompt defines:
  - the exact target person facts (ground truth)
  - response format constraints
  - Icelandic output
  - shortness policy

### Output schema
- `label`: `yes | no | unknown | probably_yes | probably_no`
- `answer_text_is`: short Icelandic text (1 sentence)
- Optional `confidence` for internal telemetry

### Guardrails
- Reject long/multi-paragraph outputs.
- Normalize to controlled labels.
- If question is irrelevant/ambiguous, return `unknown` with short guidance.
- Enforce no leakage of exact name before correct guess.

---

## 9) Scoring & Leaderboard

Primary sort:
1. Fewest questions to correct guess
2. Lowest `time_from_start`
3. Lowest `time_from_open`
4. Earliest correct timestamp (tie-break)

Metrics recorded:
- `question_count`
- `time_from_start_ms = solved_at - started_at`
- `time_from_open_ms = solved_at - opens_at`

Only solved sessions appear on leaderboard.

---

## 10) Device Identity (No Login)

- Generate random `device_id` on first visit; store in localStorage.
- Send hashed value to backend (`sha256(device_id + pepper)` server-side preferred).
- Session recovery by device+round.
- If localStorage cleared, user is treated as new device.

Optional hardening:
- Signed, httpOnly cookie for tamper resistance.
- Light rate limiting by IP + device hash.

---

## 11) Security & Abuse Mitigation

- Rate limit `/api/question` and `/api/guess`.
- Basic profanity/spam filtering for question input length/content.
- CORS locked to production domain.
- Admin endpoints protected via Cloudflare Access or secret token.
- Never expose hidden person name in client before reveal.

---

## 12) Observability

- Structured logs per request with round/session IDs.
- Track:
  - LLM latency/error rate
  - question volume
  - solve rate
  - hint usage
- Daily snapshot job for analytics exports (optional).

---

## 13) Deployment Layout

Single repo:
- SvelteKit app + server routes
- Worker-compatible adapter
- D1 migrations
- Optional seed scripts

Environments:
- `dev`, `staging`, `prod`
- Separate D1 DB per environment
- Separate model/API keys per environment

---

## 14) Milestone Plan

### M1 — Core loop
- Round status + countdown
- Start session
- Ask question (mock answers)
- Guess + close/open logic

### M2 — Real LLM + persistence
- D1 schema + migrations
- Real LLM orchestrator
- Hint endpoint
- Correct guess reveal

### M3 — Leaderboard + sharing
- Ranking computation
- Public leaderboard page
- Share card text/image payload

### M4 — Admin & polish
- Admin CRUD for persons/round assignment
- Abuse controls + rate limits
- UI polish (Typeform style, mobile-first)

---

## 15) Open Decisions

1. Exact model provider(s) and fallback order.
2. Hint policy format (free text vs controlled clue categories).
3. Whether to allow multiple guesses or penalize each wrong guess.
4. Whether leaderboard is global only or also friends/share-group scoped.
5. Content moderation policy for person selection.

---

## 16) Recommended Next Step

Implement M1 skeleton first with mocked data and deterministic clock logic in `Atlantic/Reykjavik`, then connect D1 and LLM in M2.
