import { desc, eq, inArray } from 'drizzle-orm';
import { randomId } from '$lib/shared/id';
import { extractGuessText, inferIntentHeuristically } from '$lib/server/llm';
import { deviceSessions, persons, rounds, submissionEvents, usernames } from '$lib/server/db/schema';

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

function parseCsvList(input?: string, limit = 25) {
  if (!input) return [] as string[];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseRoundTimes(roundId: string) {
  const opensAt = new Date(`${roundId}T12:00:00.000Z`);
  const closesAt = new Date(`${roundId}T17:00:00.000Z`);
  return { opensAt, closesAt };
}

function looksLikeQuestion(text: string) {
  const t = text.trim();
  if (!t) return false;
  if (t.includes('?')) return true;

  const normalized = t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  return /^(er|eru|hefur|hefurdu|hvad|hvað|hver|hvar|hvenaer|hvenær|afhverju|is|are|does|did|can)\b/.test(
    normalized
  );
}

function isMissingTableError(errorInput: unknown, tableName: string) {
  const message = errorInput instanceof Error ? errorInput.message : String(errorInput ?? '');
  const lower = message.toLowerCase();
  return lower.includes('no such table') && lower.includes(tableName.toLowerCase());
}

function reviewSubmissionRow(row: {
  inputText: string;
  intentKind: string;
  resolvedKind: string;
  normalizedGuessText: string | null;
  answerLabel: string | null;
}) {
  const expected = inferIntentHeuristically(row.inputText) ?? 'question';
  const flags: string[] = [];

  if (expected !== row.intentKind) {
    flags.push('intent_vs_heuristic');
  }

  if (row.resolvedKind === 'guess' && looksLikeQuestion(row.inputText) && expected === 'question') {
    flags.push('question_routed_as_guess');
  }

  if (row.resolvedKind === 'question') {
    const extractedGuess = extractGuessText(row.inputText);
    const guessChanged = extractedGuess.trim().toLowerCase() !== row.inputText.trim().toLowerCase();
    if (guessChanged && expected === 'guess') {
      flags.push('guess_routed_as_question');
    }
  }

  if (row.resolvedKind === 'question' && row.answerLabel === 'unknown') {
    flags.push('unknown_answer');
  }

  return {
    expectedIntentKind: expected,
    likelyMismatch: flags.some((flag) => flag !== 'unknown_answer'),
    flags
  };
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
  input: {
    displayName: string;
    descriptionIs: string;
    imageUrl: string;
    aliasesCsv?: string;
    isIcelander?: boolean;
    yesKeywordsCsv?: string;
    noKeywordsCsv?: string;
  }
) {
  const id = randomId();
  const slug = `${slugify(input.displayName)}-${id.slice(0, 8)}`;
  const aliases = parseCsvList(input.aliasesCsv, 25);
  const yesKeywords = parseCsvList(input.yesKeywordsCsv, 40);
  const noKeywords = parseCsvList(input.noKeywordsCsv, 40);

  await db
    .insert(persons)
    .values({
      id,
      displayName: input.displayName,
      slug,
      descriptionIs: input.descriptionIs,
      imageUrl: input.imageUrl,
      metadataJson: JSON.stringify({
        aliases,
        isIcelander: input.isIcelander,
        yesKeywords,
        noKeywords
      }),
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

export async function listSubmissionEventsAdmin(
  db: Db,
  input: { roundId?: string; limit?: number; flaggedOnly?: boolean } = {}
) {
  const limit = Math.max(1, Math.min(500, input.limit ?? 200));

  let rows: any[] = [];

  try {
    rows = input.roundId
      ? await db
          .select({
            id: submissionEvents.id,
            roundId: submissionEvents.roundId,
            sessionId: submissionEvents.sessionId,
            inputText: submissionEvents.inputText,
            intentKind: submissionEvents.intentKind,
            resolvedKind: submissionEvents.resolvedKind,
            normalizedGuessText: submissionEvents.normalizedGuessText,
            answerLabel: submissionEvents.answerLabel,
            answerTextIs: submissionEvents.answerTextIs,
            guessCorrect: submissionEvents.guessCorrect,
            questionCount: submissionEvents.questionCount,
            remaining: submissionEvents.remaining,
            createdAt: submissionEvents.createdAt
          })
          .from(submissionEvents)
          .where(eq(submissionEvents.roundId, input.roundId))
          .orderBy(desc(submissionEvents.createdAt))
          .limit(limit)
      : await db
          .select({
            id: submissionEvents.id,
            roundId: submissionEvents.roundId,
            sessionId: submissionEvents.sessionId,
            inputText: submissionEvents.inputText,
            intentKind: submissionEvents.intentKind,
            resolvedKind: submissionEvents.resolvedKind,
            normalizedGuessText: submissionEvents.normalizedGuessText,
            answerLabel: submissionEvents.answerLabel,
            answerTextIs: submissionEvents.answerTextIs,
            guessCorrect: submissionEvents.guessCorrect,
            questionCount: submissionEvents.questionCount,
            remaining: submissionEvents.remaining,
            createdAt: submissionEvents.createdAt
          })
          .from(submissionEvents)
          .orderBy(desc(submissionEvents.createdAt))
          .limit(limit);
  } catch (error) {
    if (isMissingTableError(error, 'submission_events')) {
      return {
        submissions: [],
        stats: { total: 0, flagged: 0, unknownAnswers: 0, guesses: 0, correctGuesses: 0 },
        warning: 'SUBMISSION_EVENTS_TABLE_MISSING'
      };
    }

    throw error;
  }

  const sessionIds = [...new Set(rows.map((row: any) => String(row.sessionId)).filter(Boolean))] as string[];

  const sessionRows = sessionIds.length
    ? await db
        .select({ id: deviceSessions.id, deviceIdHash: deviceSessions.deviceIdHash })
        .from(deviceSessions)
        .where(inArray(deviceSessions.id, sessionIds))
    : [];

  const hashBySessionId = new Map<string, string>(
    sessionRows.map((row: any) => [String(row.id), String(row.deviceIdHash)])
  );
  const hashes = [...new Set(sessionRows.map((row: any) => String(row.deviceIdHash)).filter(Boolean))] as string[];

  const usernameRows = hashes.length
    ? await db
        .select({ deviceIdHash: usernames.deviceIdHash, username: usernames.username })
        .from(usernames)
        .where(inArray(usernames.deviceIdHash, hashes))
    : [];

  const usernameByHash = new Map<string, string>(
    usernameRows.map((row: any) => [String(row.deviceIdHash), String(row.username)])
  );

  type AdminSubmissionRow = {
    id: string;
    roundId: string;
    sessionId: string;
    username: string | null;
    inputText: string;
    intentKind: string;
    resolvedKind: string;
    expectedIntentKind: 'question' | 'guess' | 'hint';
    likelyMismatch: boolean;
    reviewFlags: string[];
    normalizedGuessText: string | null;
    answerLabel: string | null;
    answerTextIs: string | null;
    guessCorrect: boolean | null;
    questionCount: number;
    remaining: number;
    createdAt: number | null;
  };

  const enriched: AdminSubmissionRow[] = rows.map((row: any) => {
    const deviceHash = hashBySessionId.get(String(row.sessionId));
    const review = reviewSubmissionRow({
      inputText: String(row.inputText ?? ''),
      intentKind: String(row.intentKind ?? 'question'),
      resolvedKind: String(row.resolvedKind ?? 'question'),
      normalizedGuessText: row.normalizedGuessText,
      answerLabel: row.answerLabel
    });

    return {
      id: row.id,
      roundId: row.roundId,
      sessionId: row.sessionId,
      username: deviceHash ? usernameByHash.get(deviceHash) ?? null : null,
      inputText: row.inputText,
      intentKind: row.intentKind,
      resolvedKind: row.resolvedKind,
      expectedIntentKind: review.expectedIntentKind,
      likelyMismatch: review.likelyMismatch,
      reviewFlags: review.flags,
      normalizedGuessText: row.normalizedGuessText,
      answerLabel: row.answerLabel,
      answerTextIs: row.answerTextIs,
      guessCorrect: row.guessCorrect,
      questionCount: row.questionCount,
      remaining: row.remaining,
      createdAt: row.createdAt?.getTime?.() ?? null
    };
  });

  const submissions = input.flaggedOnly ? enriched.filter((row) => row.likelyMismatch) : enriched;

  const stats = {
    total: enriched.length,
    flagged: enriched.filter((row) => row.likelyMismatch).length,
    unknownAnswers: enriched.filter((row) => row.answerLabel === 'unknown').length,
    guesses: enriched.filter((row) => row.resolvedKind === 'guess').length,
    correctGuesses: enriched.filter((row) => row.resolvedKind === 'guess' && row.guessCorrect === true).length
  };

  return { submissions, stats, warning: null as string | null };
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
