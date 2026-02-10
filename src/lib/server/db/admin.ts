import { desc, eq } from 'drizzle-orm';
import { randomId } from '$lib/shared/id';
import { persons, rounds } from '$lib/server/db/schema';

type Db = any;

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseAliasesCsv(input?: string) {
  if (!input) return [] as string[];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function parseRoundTimes(roundId: string) {
  const opensAt = new Date(`${roundId}T12:00:00.000Z`);
  const closesAt = new Date(`${roundId}T17:00:00.000Z`);
  return { opensAt, closesAt };
}

export async function listPersonsAdmin(db: Db) {
  const rows = await db.select().from(persons).orderBy(desc(persons.createdAt)).limit(200);
  return rows.map((row: any) => ({
    id: row.id,
    displayName: row.displayName,
    descriptionIs: row.descriptionIs,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt?.getTime?.() ?? null
  }));
}

export async function createPersonAdmin(
  db: Db,
  input: { displayName: string; descriptionIs: string; imageUrl: string; aliasesCsv?: string }
) {
  const id = randomId();
  const slug = `${slugify(input.displayName)}-${id.slice(0, 8)}`;
  const aliases = parseAliasesCsv(input.aliasesCsv);

  await db
    .insert(persons)
    .values({
      id,
      displayName: input.displayName,
      slug,
      descriptionIs: input.descriptionIs,
      imageUrl: input.imageUrl,
      metadataJson: JSON.stringify({ aliases }),
      createdAt: new Date()
    })
    .run();

  return { id, displayName: input.displayName };
}

export async function getRoundAssignmentAdmin(db: Db, roundId: string) {
  const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
  if (!round) return null;

  const [person] = await db.select().from(persons).where(eq(persons.id, round.personId)).limit(1);
  return {
    roundId: round.id,
    personId: round.personId,
    personName: person?.displayName ?? null,
    hintTextIs: round.hintTextIs,
    opensAt: round.opensAtUtc?.getTime?.() ?? null,
    closesAt: round.closesAtUtc?.getTime?.() ?? null
  };
}

export async function assignPersonToRoundAdmin(
  db: Db,
  input: { roundId: string; personId: string; hintTextIs?: string }
) {
  const [person] = await db.select().from(persons).where(eq(persons.id, input.personId)).limit(1);
  if (!person) throw new Error('PERSON_NOT_FOUND');

  const { opensAt, closesAt } = parseRoundTimes(input.roundId);

  await db
    .insert(rounds)
    .values({
      id: input.roundId,
      dateYmd: input.roundId,
      personId: input.personId,
      opensAtUtc: opensAt,
      closesAtUtc: closesAt,
      hintTextIs: input.hintTextIs?.trim() || null,
      createdAt: new Date()
    })
    .onConflictDoUpdate({
      target: rounds.id,
      set: {
        personId: input.personId,
        opensAtUtc: opensAt,
        closesAtUtc: closesAt,
        hintTextIs: input.hintTextIs?.trim() || null
      }
    })
    .run();

  return {
    ok: true,
    roundId: input.roundId,
    personId: input.personId,
    personName: person.displayName
  };
}
