import { command, getRequestEvent, query } from '$app/server';
import { getDb } from '$lib/server/db/client';
import { randomId } from '$lib/shared/id';
import { answerQuestionWithLlm } from '$lib/server/llm';
import {
  askQuestionDb,
  getLeaderboardDb,
  getSessionStateDb,
  startSessionDb,
  submitGuessDb,
  useHintDb
} from '$lib/server/db/game';
import { getUsernameByDeviceId, setUsernameForDeviceId } from '$lib/server/db/profile';
import {
  askQuestion,
  getCurrentRound,
  getLeaderboard,
  getSessionState,
  randomRoundId,
  startSession,
  submitGuess,
  useHint
} from '$lib/server/game';
import {
  guessBodySchema,
  hintBodySchema,
  leaderboardQuerySchema,
  questionBodySchema,
  sessionStateQuerySchema,
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
      devRandomRoundPerSession
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

export const getUsernameQuery = query(usernameQuerySchema, async (input) => {
  const { db } = getServices();
  if (!db) return { username: null };
  const username = await getUsernameByDeviceId(db, input.deviceId);
  return { username };
});

export const setUsernameCommand = command(usernameSetSchema, async (input) => {
  const { db } = getServices();
  if (!db) throw new Error('DB_NOT_CONFIGURED');
  return setUsernameForDeviceId(db, input);
});

export const getLeaderboardQuery = query(leaderboardQuerySchema, async (input) => {
  const { db, forceRoundOpen } = getServices();
  const requestedRoundId = input.roundId || getCurrentRound(Date.now(), { forceOpen: forceRoundOpen }).id;
  const leaderboard = db ? await getLeaderboardDb(db, requestedRoundId) : getLeaderboard(requestedRoundId);
  return { roundId: requestedRoundId, leaderboard };
});
