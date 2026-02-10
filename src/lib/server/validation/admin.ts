import * as v from 'valibot';

const tokenSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));

export const adminAuthSchema = v.object({
  token: tokenSchema
});

export const adminCreatePersonSchema = v.object({
  token: tokenSchema,
  displayName: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(120)),
  descriptionIs: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(400)),
  imageUrl: v.pipe(v.string(), v.trim(), v.url(), v.maxLength(500)),
  aliasesCsv: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)))
});

export const adminRoundQuerySchema = v.object({
  token: tokenSchema,
  roundId: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))
});

export const adminAssignRoundSchema = v.object({
  token: tokenSchema,
  roundId: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  personId: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  hintTextIs: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(300)))
});
