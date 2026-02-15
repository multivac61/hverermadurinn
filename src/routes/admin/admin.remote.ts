import { command, getRequestEvent } from '$app/server';
import { assertAdminToken } from '$lib/server/admin-auth';
import { getDb } from '$lib/server/db/client';
import {
  assignPersonToRoundAdmin,
  createPersonAdmin,
  getRoundAssignmentAdmin,
  listPersonsAdmin,
  listSubmissionEventsAdmin
} from '$lib/server/db/admin';
import {
  adminAssignRoundSchema,
  adminAuthSchema,
  adminCreatePersonSchema,
  adminRoundQuerySchema,
  adminSubmissionsQuerySchema
} from '$lib/server/validation/admin';

function requireDb() {
  const event = getRequestEvent();
  const db = getDb(event);
  if (!db) throw new Error('DB_NOT_CONFIGURED');
  return db;
}

export const adminListPersons = command(adminAuthSchema, async ({ token }) => {
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
    aliasesCsv: input.aliasesCsv,
    isIcelander: input.isIcelander,
    yesKeywordsCsv: input.yesKeywordsCsv,
    noKeywordsCsv: input.noKeywordsCsv
  });
});

export const adminGetRound = command(adminRoundQuerySchema, async (input) => {
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

export const adminListSubmissions = command(adminSubmissionsQuerySchema, async (input) => {
  assertAdminToken(input.token);
  const db = requireDb();
  const result = await listSubmissionEventsAdmin(db, {
    roundId: input.roundId,
    limit: input.limit,
    flaggedOnly: input.flaggedOnly
  });
  return result;
});
