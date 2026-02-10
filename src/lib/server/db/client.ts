import type { RequestEvent } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/d1';

export function getDb(event: RequestEvent) {
  const dbBinding = event.platform?.env?.DB;
  if (!dbBinding) return null;
  return drizzle(dbBinding);
}
