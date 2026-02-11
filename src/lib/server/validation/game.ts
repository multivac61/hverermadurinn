import * as v from 'valibot';

export const startSessionBodySchema = v.object({
  deviceId: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
  randomizeRound: v.optional(v.boolean()),
  freshDevice: v.optional(v.boolean()),
  forceRoundOpen: v.optional(v.boolean())
});

export const questionBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  question: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(400)),
  forceRoundOpen: v.optional(v.boolean())
});

export const singleInputBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  input: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(400)),
  forceRoundOpen: v.optional(v.boolean())
});

export const guessBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  guess: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  forceRoundOpen: v.optional(v.boolean())
});

export const hintBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  forceRoundOpen: v.optional(v.boolean())
});

export const inputIntentBodySchema = v.object({
  input: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(400))
});

export const sessionStateQuerySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120))
});

export const leaderboardQuerySchema = v.object({
  roundId: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)))
});

const usernameRegex = /^[a-zA-Z0-9_\-]{3,24}$/;

export const usernameQuerySchema = v.object({
  deviceId: v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(200))
});

export const usernameSetSchema = v.object({
  deviceId: v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(200)),
  username: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(3),
    v.maxLength(24),
    v.regex(usernameRegex, 'Username must be 3-24 chars: letters, numbers, _ or -')
  )
});
