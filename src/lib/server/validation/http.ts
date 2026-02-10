import * as v from 'valibot';

export function validateOrThrow<T>(schema: any, input: unknown): T {
  const result = v.safeParse(schema, input);
  if (result.success) return result.output as T;

  const firstIssue = result.issues?.[0];
  const message = firstIssue?.message ?? 'Invalid request data';
  throw new Error(message);
}
