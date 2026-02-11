import { command, getRequestEvent, query } from '$app/server';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db/client';
import { randomId } from '$lib/shared/id';
import { answerQuestionWithLlm, classifyInputIntentWithLlm } from '$lib/server/llm';
import {
  askQuestionDb,
  getLeaderboardDb,
  getSessionStateDb,
  startSessionDb,
  submitGuessDb,
  useHintDb
} from '$lib/server/db/game';
import { getUsernameByDeviceId, setUsernameForDeviceId } from '$lib/server/db/profile';
import { persons, rounds } from '$lib/server/db/schema';
import {
  askQuestion,
  getCurrentRound,
  getLeaderboard,
  getPersonForRoundId,
  getSessionState,
  randomRoundId,
  startSession,
  submitGuess,
  useHint
} from '$lib/server/game';
import {
  debugRoundInfoQuerySchema,
  guessBodySchema,
  hintBodySchema,
  leaderboardQuerySchema,
  questionBodySchema,
  sessionStateQuerySchema,
  singleInputBodySchema,
  startSessionBodySchema,
  usernameQuerySchema,
  usernameSetSchema
} from '$lib/server/validation/game';

function getServices() {
  const event = getRequestEvent();
  const db = getDb(event);
  const env = event.platform?.env;
  const forceRoundOpen = String(env?.FORCE_ROUND_OPEN || 'false').toLowerCase() === 'true';
  const devRandomRoundPerSession =
    String(env?.DEV_RANDOM_ROUND_PER_SESSION || 'false').toLowerCase() === 'true';
  return { db, env, forceRoundOpen, devRandomRoundPerSession };
}

export const getRound = query(async () => {
  const { forceRoundOpen, devRandomRoundPerSession } = getServices();
  const round = getCurrentRound(Date.now(), { forceOpen: forceRoundOpen });
  const canExposeDebugPerson = forceRoundOpen || devRandomRoundPerSession;

  return {
    round: {
      id: round.id,
      ymd: round.ymd,
      status: round.status,
      opensAt: round.opensAt,
      closesAt: round.closesAt,
      countdownMs: round.countdownMs,
      maxQuestions: round.maxQuestions
    },
    debug: {
      forceRoundOpen,
      devRandomRoundPerSession,
      currentPersonId: canExposeDebugPerson ? round.person.id : null,
      currentPersonName: canExposeDebugPerson ? round.person.displayName : null
    },
    revealPerson:
      round.status === 'closed'
        ? {
            displayName: round.person.displayName,
            revealTextIs: round.person.revealTextIs,
            imageUrl: round.person.imageUrl
          }
        : null
  };
});

export const getDebugRoundInfoQuery = query(debugRoundInfoQuerySchema, async (input) => {
  const { db, forceRoundOpen, devRandomRoundPerSession } = getServices();
  const debugAllowed = forceRoundOpen || devRandomRoundPerSession;

  if (!debugAllowed) {
    return { roundId: input.roundId, personId: null, personName: null };
  }

  if (db) {
    const [roundRow] = await db.select().from(rounds).where(eq(rounds.id, input.roundId)).limit(1);
    if (roundRow) {
      const [personRow] = await db.select().from(persons).where(eq(persons.id, roundRow.personId)).limit(1);
      return {
        roundId: input.roundId,
        personId: roundRow.personId,
        personName: personRow?.displayName ?? null
      };
    }
  }

  const fallback = getPersonForRoundId(input.roundId);
  return { roundId: input.roundId, personId: fallback.id, personName: fallback.displayName };
});

export const startSessionCommand = command(startSessionBodySchema, async (input) => {
  const { db, forceRoundOpen, devRandomRoundPerSession } = getServices();

  const freshDevice = input.freshDevice === true;
  const deviceId = freshDevice ? `anon-${randomId()}` : input.deviceId?.trim() || `anon-${randomId()}`;

  const shouldRandomize = input.randomizeRound === true || devRandomRoundPerSession;
  const roundIdOverride = shouldRandomize ? randomRoundId() : undefined;
  const effectiveForceOpen = forceRoundOpen || input.forceRoundOpen === true;

  const session = db
    ? await startSessionDb(db, deviceId, Date.now(), {
        forceRoundOpen: effectiveForceOpen,
        roundIdOverride
      })
    : startSession(deviceId, Date.now(), { forceOpen: effectiveForceOpen, roundIdOverride });

  return {
    session: {
      id: session.id,
      roundId: session.roundId,
      startedAt: session.startedAt,
      questionCount: session.questionCount,
      hintUsed: session.hintUsed,
      solved: session.solved
    }
  };
});

export const getSessionStateQuery = query(sessionStateQuerySchema, async (input) => {
  const { db } = getServices();
  return db ? await getSessionStateDb(db, input.sessionId) : getSessionState(input.sessionId);
});

export const askQuestionCommand = command(questionBodySchema, async (input) => {
  const { db, env, forceRoundOpen } = getServices();
  const effectiveForceOpen = forceRoundOpen || input.forceRoundOpen === true;
  return db
    ? await askQuestionDb(
        db,
        input.sessionId,
        input.question,
        Date.now(),
        async ({ question, person }) => answerQuestionWithLlm({ question, person, env }),
        { forceRoundOpen: effectiveForceOpen }
      )
    : askQuestion(input.sessionId, input.question, Date.now(), { forceOpen: effectiveForceOpen });
});

export const submitGuessCommand = command(guessBodySchema, async (input) => {
  const { db, forceRoundOpen } = getServices();
  const effectiveForceOpen = forceRoundOpen || input.forceRoundOpen === true;
  return db
    ? await submitGuessDb(db, input.sessionId, input.guess, Date.now(), {
        forceRoundOpen: effectiveForceOpen
      })
    : submitGuess(input.sessionId, input.guess, Date.now(), { forceOpen: effectiveForceOpen });
});

export const requestHintCommand = command(hintBodySchema, async (input) => {
  const { db, forceRoundOpen } = getServices();
  const effectiveForceOpen = forceRoundOpen || input.forceRoundOpen === true;
  return db
    ? await useHintDb(db, input.sessionId, Date.now(), { forceRoundOpen: effectiveForceOpen })
    : useHint(input.sessionId, Date.now(), { forceOpen: effectiveForceOpen });
});

export const handleInputCommand = command(singleInputBodySchema, async (input) => {
  const { db, env, forceRoundOpen } = getServices();
  const effectiveForceOpen = forceRoundOpen || input.forceRoundOpen === true;
  const text = input.input.trim();
  const lower = text.toLowerCase();

  const explicitHint = ['vísbending', 'visbending', 'hint', 'hjálp', 'hjalp'].includes(lower);

  const intent = explicitHint
    ? { kind: 'hint' as const }
    : await classifyInputIntentWithLlm({ inputText: text, env });

  if (intent.kind === 'hint') {
    const result = db
      ? await useHintDb(db, input.sessionId, Date.now(), { forceRoundOpen: effectiveForceOpen })
      : useHint(input.sessionId, Date.now(), { forceOpen: effectiveForceOpen });
    return {
      kind: 'hint' as const,
      hint: result.hint,
      answerTextIs: 'Vísbending móttekin.'
    };
  }

  if (intent.kind === 'guess') {
    const guessText = text.replace(/^(gisk|giska|guess)\s*:\s*/i, '').trim();
    const result = db
      ? await submitGuessDb(db, input.sessionId, guessText, Date.now(), {
          forceRoundOpen: effectiveForceOpen
        })
      : submitGuess(input.sessionId, guessText, Date.now(), { forceOpen: effectiveForceOpen });

    return {
      kind: 'guess' as const,
      correct: result.correct,
      solved: result.solved,
      revealPerson: result.revealPerson,
      answerTextIs: result.correct ? '' : 'Nei.'
    };
  }

  const result = db
    ? await askQuestionDb(
        db,
        input.sessionId,
        text,
        Date.now(),
        async ({ question, person }) => answerQuestionWithLlm({ question, person, env }),
        { forceRoundOpen: effectiveForceOpen }
      )
    : askQuestion(input.sessionId, text, Date.now(), { forceOpen: effectiveForceOpen });

  return {
    kind: 'question' as const,
    answerLabel: result.answerLabel,
    answerTextIs: result.answerTextIs,
    questionCount: result.questionCount,
    remaining: result.remaining
  };
});

export const getUsernameQuery = query(usernameQuerySchema, async (input) => {
  const { db } = getServices();
  if (!db) return { username: null };
  const username = await getUsernameByDeviceId(db, input.deviceId);
  return { username };
});

export const setUsernameCommand = command(usernameSetSchema, async (input) => {
  const { db } = getServices();
  if (!db) {
    return { ok: false as const, error: 'DB_NOT_CONFIGURED' as const };
  }

  try {
    const result = await setUsernameForDeviceId(db, input);
    return { ok: true as const, username: result.username };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'USERNAME_TAKEN') {
      return { ok: false as const, error: 'USERNAME_TAKEN' as const };
    }
    return { ok: false as const, error: 'UNKNOWN_ERROR' as const };
  }
});

export const getLeaderboardQuery = query(leaderboardQuerySchema, async (input) => {
  const { db, forceRoundOpen } = getServices();
  const requestedRoundId = input.roundId || getCurrentRound(Date.now(), { forceOpen: forceRoundOpen }).id;
  const leaderboard = db ? await getLeaderboardDb(db, requestedRoundId) : getLeaderboard(requestedRoundId);
  return { roundId: requestedRoundId, leaderboard };
});
