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

export const guessBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  guess: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
  forceRoundOpen: v.optional(v.boolean())
});

export const hintBodySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  forceRoundOpen: v.optional(v.boolean())
});

export const sessionStateQuerySchema = v.object({
  sessionId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120))
});

export const leaderboardQuerySchema = v.object({
  roundId: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)))
});
