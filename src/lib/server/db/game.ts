import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomId } from '$lib/shared/id';
import { hashDeviceId } from '$lib/server/device';
import { deviceSessions, guessEvents, persons, questionEvents, rounds, usernames } from '$lib/server/db/schema';
import {
  MAX_QUESTIONS,
  PERSONS,
  answerQuestionForPerson,
  getCurrentRound,
  getPersonForRoundId,
  isCorrectGuess
} from '$lib/server/game';

type Db = any;

type AnswerPayload = {
  answerLabel: 'yes' | 'no' | 'unknown' | 'probably_yes' | 'probably_no';
  answerTextIs: string;
};

type AnswerResolver = (input: { question: string; person: any }) => Promise<AnswerPayload>;

type RoundRuntimeOptions = {
  forceRoundOpen?: boolean;
};

function parseRoundOpen(roundId: string) {
  return new Date(`${roundId}T12:00:00.000Z`).getTime();
}

async function ensurePersons(db: Db) {
  await db
    .insert(persons)
    .values(
      PERSONS.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        slug: person.id,
        descriptionIs: person.revealTextIs,
        imageUrl: person.imageUrl,
        metadataJson: JSON.stringify({ aliases: person.aliases }),
        createdAt: new Date()
      }))
    )
    .onConflictDoNothing()
    .run();
}

async function ensureRound(db: Db, now = Date.now(), roundIdOverride?: string) {
  const round = getCurrentRound(now, { roundIdOverride });
  const person = getPersonForRoundId(round.id);

  await ensurePersons(db);

  await db
    .insert(rounds)
    .values({
      id: round.id,
      dateYmd: round.id,
      personId: person.id,
      opensAtUtc: new Date(round.opensAt),
      closesAtUtc: new Date(round.closesAt),
      hintTextIs: person.hintIs,
      createdAt: new Date(now)
    })
    .onConflictDoNothing()
    .run();

  return { round, person };
}

export async function startSessionDb(
  db: Db,
  deviceId: string,
  now = Date.now(),
  options: RoundRuntimeOptions & { roundIdOverride?: string } = {}
) {
  const { round } = await ensureRound(db, now, options.roundIdOverride);
  const deviceIdHash = hashDeviceId(deviceId);

  const [existing] = await db
    .select()
    .from(deviceSessions)
    .where(and(eq(deviceSessions.roundId, round.id), eq(deviceSessions.deviceIdHash, deviceIdHash)))
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      roundId: existing.roundId,
      startedAt: existing.startedAt?.getTime() ?? now,
      questionCount: existing.questionCount,
      hintUsed: existing.hintUsed,
      solved: existing.solved,
      solvedAt: existing.solvedAt?.getTime() ?? null
    };
  }

  const session = {
    id: randomId(),
    roundId: round.id,
    deviceIdHash,
    startedAt: new Date(now),
    questionCount: 0,
    hintUsed: false,
    solved: false,
    solvedAt: null as Date | null
  };

  await db.insert(deviceSessions).values(session).run();

  return {
    id: session.id,
    roundId: round.id,
    startedAt: now,
    questionCount: 0,
    hintUsed: false,
    solved: false,
    solvedAt: null
  };
}

async function loadSession(db: Db, sessionId: string) {
  const [session] = await db.select().from(deviceSessions).where(eq(deviceSessions.id, sessionId)).limit(1);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  return session;
}

export async function getSessionStateDb(db: Db, sessionId: string) {
  const [session] = await db.select().from(deviceSessions).where(eq(deviceSessions.id, sessionId)).limit(1);
  if (!session) return null;

  const questions = await db
    .select({
      question: questionEvents.questionText,
      answerLabel: questionEvents.answerLabel,
      answerTextIs: questionEvents.answerTextIs,
      createdAt: questionEvents.createdAt
    })
    .from(questionEvents)
    .where(eq(questionEvents.sessionId, sessionId))
    .orderBy(asc(questionEvents.createdAt));

  return {
    session: {
      id: session.id,
      roundId: session.roundId,
      startedAt: session.startedAt?.getTime() ?? 0,
      questionCount: session.questionCount,
      hintUsed: session.hintUsed,
      solved: session.solved,
      solvedAt: session.solvedAt?.getTime() ?? null
    },
    questions: questions.map((q: any) => ({
      question: q.question,
      answerLabel: q.answerLabel,
      answerTextIs: q.answerTextIs,
      createdAt: q.createdAt?.getTime() ?? 0
    }))
  };
}

function parseAliases(metadataJson: string | null) {
  if (!metadataJson) return [] as string[];
  try {
    const parsed = JSON.parse(metadataJson) as { aliases?: unknown };
    return Array.isArray(parsed.aliases)
      ? parsed.aliases.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

async function resolvePersonForSession(db: Db, roundId: string) {
  const [roundRow] = await db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
  if (!roundRow) return getPersonForRoundId(roundId);

  const [personRow] = await db.select().from(persons).where(eq(persons.id, roundRow.personId)).limit(1);
  if (!personRow) return getPersonForRoundId(roundId);

  const fallback = getPersonForRoundId(roundId);
  const aliases = parseAliases(personRow.metadataJson);

  return {
    id: personRow.id,
    displayName: personRow.displayName,
    revealTextIs: personRow.descriptionIs,
    imageUrl: personRow.imageUrl || fallback.imageUrl,
    aliases: aliases.length > 0 ? aliases : fallback.aliases,
    hintIs: roundRow.hintTextIs || fallback.hintIs,
    isIcelander: fallback.isIcelander,
    yesKeywords: fallback.yesKeywords,
    noKeywords: fallback.noKeywords
  };
}

export async function askQuestionDb(
  db: Db,
  sessionId: string,
  question: string,
  now = Date.now(),
  resolver?: AnswerResolver,
  options: RoundRuntimeOptions = {}
) {
  const session = await loadSession(db, sessionId);
  const currentRound = getCurrentRound(now, { forceOpen: options.forceRoundOpen });

  if (!options.forceRoundOpen && session.roundId !== currentRound.id)
    throw new Error('SESSION_ROUND_MISMATCH');
  if (currentRound.status !== 'open') throw new Error('ROUND_NOT_OPEN');
  if (session.solved) throw new Error('ALREADY_SOLVED');
  if (session.questionCount >= MAX_QUESTIONS) throw new Error('QUESTION_LIMIT_REACHED');

  const person = await resolvePersonForSession(db, session.roundId);
  const { answerLabel, answerTextIs } = resolver
    ? await resolver({ question, person })
    : answerQuestionForPerson(question, person);
  const nextCount = session.questionCount + 1;

  await db
    .insert(questionEvents)
    .values({
      id: randomId(),
      roundId: session.roundId,
      sessionId,
      questionText: question,
      answerLabel,
      answerTextIs,
      createdAt: new Date(now)
    })
    .run();

  await db
    .update(deviceSessions)
    .set({ questionCount: nextCount })
    .where(eq(deviceSessions.id, sessionId))
    .run();

  return {
    answerLabel,
    answerTextIs,
    questionCount: nextCount,
    remaining: Math.max(0, MAX_QUESTIONS - nextCount)
  };
}

export async function useHintDb(
  db: Db,
  sessionId: string,
  now = Date.now(),
  options: RoundRuntimeOptions = {}
) {
  const session = await loadSession(db, sessionId);
  const currentRound = getCurrentRound(now, { forceOpen: options.forceRoundOpen });

  if (!options.forceRoundOpen && session.roundId !== currentRound.id)
    throw new Error('SESSION_ROUND_MISMATCH');
  if (currentRound.status !== 'open') throw new Error('ROUND_NOT_OPEN');
  if (session.hintUsed) throw new Error('HINT_ALREADY_USED');

  await db
    .update(deviceSessions)
    .set({ hintUsed: true })
    .where(eq(deviceSessions.id, sessionId))
    .run();

  const person = await resolvePersonForSession(db, session.roundId);
  return {
    hint: person.hintIs,
    hintUsed: true
  };
}

export async function submitGuessDb(
  db: Db,
  sessionId: string,
  guess: string,
  now = Date.now(),
  options: RoundRuntimeOptions = {}
) {
  const session = await loadSession(db, sessionId);
  const currentRound = getCurrentRound(now, { forceOpen: options.forceRoundOpen });

  if (!options.forceRoundOpen && session.roundId !== currentRound.id)
    throw new Error('SESSION_ROUND_MISMATCH');
  if (currentRound.status !== 'open' && !session.solved) throw new Error('ROUND_NOT_OPEN');

  const person = await resolvePersonForSession(db, session.roundId);
  const correct = isCorrectGuess(guess, person);

  let solved = session.solved;
  let solvedAtMs = session.solvedAt?.getTime() ?? null;

  if (correct && !solved) {
    solved = true;
    solvedAtMs = now;
    await db
      .update(deviceSessions)
      .set({ solved: true, solvedAt: new Date(now) })
      .where(eq(deviceSessions.id, sessionId))
      .run();
  }

  await db
    .insert(guessEvents)
    .values({
      id: randomId(),
      roundId: session.roundId,
      sessionId,
      guessText: guess,
      isCorrect: correct,
      createdAt: new Date(now)
    })
    .run();

  const reveal = solved || currentRound.status === 'closed';

  return {
    correct,
    solved,
    reveal,
    revealPerson: reveal
      ? {
          displayName: person.displayName,
          revealTextIs: person.revealTextIs,
          imageUrl: person.imageUrl
        }
      : null,
    solvedAt: solvedAtMs
  };
}

export async function getLeaderboardDb(db: Db, roundId: string) {
  const openMs = parseRoundOpen(roundId);

  const rows = await db
    .select({
      sessionId: deviceSessions.id,
      deviceIdHash: deviceSessions.deviceIdHash,
      questionCount: deviceSessions.questionCount,
      startedAt: deviceSessions.startedAt,
      solvedAt: deviceSessions.solvedAt
    })
    .from(deviceSessions)
    .where(and(eq(deviceSessions.roundId, roundId), eq(deviceSessions.solved, true)))
    .orderBy(asc(deviceSessions.questionCount), asc(deviceSessions.solvedAt));

  const hashes = [...new Set(rows.map((row: any) => String(row.deviceIdHash)).filter(Boolean))] as string[];
  const usernameRows = hashes.length
    ? await db
        .select({ deviceIdHash: usernames.deviceIdHash, username: usernames.username })
        .from(usernames)
        .where(inArray(usernames.deviceIdHash, hashes))
    : [];
  const usernameByHash = new Map(usernameRows.map((row: any) => [row.deviceIdHash, row.username]));

  return rows
    .filter((row: any) => row.solvedAt)
    .map((row: any) => {
      const startedAtMs = row.startedAt?.getTime() ?? 0;
      const solvedAtMs = row.solvedAt?.getTime() ?? startedAtMs;
      return {
        sessionId: row.sessionId,
        username: usernameByHash.get(row.deviceIdHash) ?? null,
        questionsUsed: row.questionCount,
        timeFromStartMs: solvedAtMs - startedAtMs,
        timeFromOpenMs: solvedAtMs - openMs,
        solvedAt: solvedAtMs
      };
    })
    .sort((a: any, b: any) => {
      if (a.questionsUsed !== b.questionsUsed) return a.questionsUsed - b.questionsUsed;
      if (a.timeFromStartMs !== b.timeFromStartMs) return a.timeFromStartMs - b.timeFromStartMs;
      if (a.timeFromOpenMs !== b.timeFromOpenMs) return a.timeFromOpenMs - b.timeFromOpenMs;
      return a.solvedAt - b.solvedAt;
    })
    .map((row: any, i: number) => ({ rank: i + 1, ...row }));
}
