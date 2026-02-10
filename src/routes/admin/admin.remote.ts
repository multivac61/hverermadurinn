import { command, getRequestEvent, query } from '$app/server';
import { assertAdminToken } from '$lib/server/admin-auth';
import { getDb } from '$lib/server/db/client';
import {
  assignPersonToRoundAdmin,
  createPersonAdmin,
  getRoundAssignmentAdmin,
  listPersonsAdmin
} from '$lib/server/db/admin';
import {
  adminAssignRoundSchema,
  adminAuthSchema,
  adminCreatePersonSchema,
  adminRoundQuerySchema
} from '$lib/server/validation/admin';

function requireDb() {
  const event = getRequestEvent();
  const db = getDb(event);
  if (!db) throw new Error('DB_NOT_CONFIGURED');
  return db;
}

export const adminListPersons = query(adminAuthSchema, async ({ token }) => {
  assertAdminToken(token);
  const db = requireDb();
  const people = await listPersonsAdmin(db);
  return { people };
});

export const adminCreatePerson = command(adminCreatePersonSchema, async (input) => {
  assertAdminToken(input.token);
  const db = requireDb();
  return createPersonAdmin(db, {
    displayName: input.displayName,
    descriptionIs: input.descriptionIs,
    imageUrl: input.imageUrl,
    aliasesCsv: input.aliasesCsv
  });
});

export const adminGetRound = query(adminRoundQuerySchema, async (input) => {
  assertAdminToken(input.token);
  const db = requireDb();
  const round = await getRoundAssignmentAdmin(db, input.roundId);
  return { round };
});

export const adminAssignRound = command(adminAssignRoundSchema, async (input) => {
  assertAdminToken(input.token);
  const db = requireDb();
  return assignPersonToRoundAdmin(db, {
    roundId: input.roundId,
    personId: input.personId,
    hintTextIs: input.hintTextIs
  });
});
