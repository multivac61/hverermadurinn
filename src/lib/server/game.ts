import { randomId } from '$lib/shared/id';

export type RoundStatus = 'scheduled' | 'open' | 'closed';
export type AnswerLabel = 'yes' | 'no' | 'unknown' | 'probably_yes' | 'probably_no';

export type Person = {
  id: string;
  displayName: string;
  revealTextIs: string;
  imageUrl: string;
  aliases: string[];
  hintIs: string;
  yesKeywords: string[];
  noKeywords: string[];
};

type Session = {
  id: string;
  roundId: string;
  deviceId: string;
  startedAt: number;
  questionCount: number;
  hintUsed: boolean;
  solved: boolean;
  solvedAt: number | null;
};

type QuestionEvent = {
  sessionId: string;
  question: string;
  answerLabel: AnswerLabel;
  answerTextIs: string;
  createdAt: number;
};

const TZ = 'Atlantic/Reykjavik';
export const MAX_QUESTIONS = 20;

export const PERSONS: Person[] = [
  {
    id: 'p-egill',
    displayName: 'Egill Skallagrímsson',
    revealTextIs: 'Skáld og víkingur úr Íslendingasögunum.',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/84/Egilssaga17.jpg',
    aliases: ['egill', 'egill skallagrimsson', 'skallagrimsson'],
    hintIs: 'Persónan tengist fornsögum Íslands og er þekkt fyrir ljóð.',
    yesKeywords: ['saga', 'forn', 'skáld', 'karl', 'islendingasaga', 'miðaldir'],
    noKeywords: ['kona', 'tónlist', 'fótbolti', 'leikari']
  },
  {
    id: 'p-bjork',
    displayName: 'Björk Guðmundsdóttir',
    revealTextIs: 'Íslensk tónlistarkona og alþjóðleg listakona.',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/74/Bj%C3%B6rk_at_S%C3%B3leyjargata.jpg',
    aliases: ['bjork', 'björk', 'bjork gudmundsdottir', 'björk guðmundsdóttir'],
    hintIs: 'Persónan er þekkt fyrir mjög sérstakan söngstíl.',
    yesKeywords: ['kona', 'söng', 'tónlist', 'list', 'pop', 'album'],
    noKeywords: ['fótbolti', 'forseti', 'vísind']
  },
  {
    id: 'p-vigdis',
    displayName: 'Vigdís Finnbogadóttir',
    revealTextIs: 'Fyrrverandi forseti Íslands og mikilvæg táknmynd.',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Vigdis_Finnbogadottir_1985.jpg',
    aliases: ['vigdis', 'vigdís', 'vigdís finnbogadóttir', 'vigdis finnbogadottir'],
    hintIs: 'Persónan tengist embætti þjóðhöfðingja.',
    yesKeywords: ['kona', 'forseti', 'stjórnmál', 'island', 'embætti'],
    noKeywords: ['fótbolti', 'rap', 'leikari']
  }
];

const sessions = new Map<string, Session>();
const sessionByRoundAndDevice = new Map<string, string>();
const questionEvents = new Map<string, QuestionEvent[]>();

function datePartsInTz(date = new Date(), timeZone = TZ) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    ymd: `${get('year')}-${get('month')}-${get('day')}`
  };
}

function parseUtc(ymd: string, hour: number) {
  return new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00.000Z`).getTime();
}

function tomorrowYmd(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const yy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function hashString(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function normalize(input: string) {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getPersonForRoundId(roundId: string): Person {
  const idx = hashString(roundId) % PERSONS.length;
  return PERSONS[idx];
}

export function getPersonById(personId: string): Person | null {
  return PERSONS.find((person) => person.id === personId) ?? null;
}

export function isGenderQuestion(question: string) {
  const q = normalize(question);
  const tokens = q.split(' ').filter(Boolean);
  const tokenSet = new Set(tokens);

  // exact-token checks only (avoid false positives like "manneskja" -> "man")
  const exactTerms = [
    'kona',
    'karl',
    'karlmadur',
    'kvenmadur',
    'karlkyn',
    'kvenkyn',
    'kk',
    'kvk',
    'male',
    'female',
    'woman',
    'boy',
    'girl',
    'hann',
    'hun',
    'hún',
    'stelpa',
    'drengur'
  ];

  if (exactTerms.some((term) => tokenSet.has(normalize(term)))) return true;

  // explicit gender phrases
  const phrases = ['hvada kyn', 'hvada kyni', 'what gender', 'is he', 'is she'];
  return phrases.some((phrase) => q.includes(phrase));
}

export function isGenderRefusalAnswer(answerText: string) {
  const t = normalize(answerText);
  return t.includes('kyn') || t.includes('gender') || t.includes('he she');
}

export function answerQuestionForPerson(question: string, person: Person) {
  const q = normalize(question);

  const mentionsName = [person.displayName, ...person.aliases]
    .map(normalize)
    .some((name) => q.includes(name));

  let answerLabel: AnswerLabel = 'unknown';
  let answerTextIs = 'Ég er ekki viss — geturðu spurt aðeins skýrar?';

  if (mentionsName) {
    answerLabel = 'unknown';
    answerTextIs = 'Ég get ekki staðfest nafn beint. Prófaðu frekar eiginleika eða hlutverk.';
  } else if (person.yesKeywords.some((k) => q.includes(normalize(k)))) {
    answerLabel = 'yes';
    answerTextIs = 'Já, það passar.';
  } else if (person.noKeywords.some((k) => q.includes(normalize(k)))) {
    answerLabel = 'no';
    answerTextIs = 'Nei, það passar ekki.';
  } else if (q.length < 8) {
    answerLabel = 'unknown';
    answerTextIs = 'Geturðu orðað þetta aðeins nánar?';
  }

  return { answerLabel, answerTextIs };
}

export function isCorrectGuess(guess: string, person: Person) {
  const normalizedGuess = normalize(guess);
  const accepted = [person.displayName, ...person.aliases].map(normalize);
  return accepted.some((candidate) => normalizedGuess === candidate || normalizedGuess.includes(candidate));
}

type RoundOptions = {
  forceOpen?: boolean;
  roundIdOverride?: string;
};

export function randomRoundId() {
  const start = Date.UTC(2000, 0, 1);
  const end = Date.UTC(2099, 11, 31);
  const ts = start + Math.floor(Math.random() * (end - start));
  const d = new Date(ts);
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getCurrentRound(now = Date.now(), options: RoundOptions = {}) {
  const date = new Date(now);
  const { ymd: todayYmd, hour } = datePartsInTz(date);
  const ymd = options.roundIdOverride ?? todayYmd;
  const opensAt = parseUtc(ymd, 12);
  const closesAt = parseUtc(ymd, 17);

  let status: RoundStatus;
  let countdownTarget: number;

  if (options.forceOpen) {
    status = 'open';
    countdownTarget = now + 5 * 60 * 60 * 1000;
  } else if (hour < 12) {
    status = 'scheduled';
    countdownTarget = opensAt;
  } else if (hour < 17) {
    status = 'open';
    countdownTarget = closesAt;
  } else {
    status = 'closed';
    countdownTarget = parseUtc(tomorrowYmd(ymd), 12);
  }

  const person = getPersonForRoundId(ymd);

  return {
    id: ymd,
    ymd,
    opensAt,
    closesAt,
    status,
    countdownTarget,
    countdownMs: Math.max(0, countdownTarget - now),
    maxQuestions: MAX_QUESTIONS,
    person
  };
}

export function startSession(deviceId: string, now = Date.now(), options: RoundOptions = {}) {
  const round = getCurrentRound(now, options);
  const key = `${round.id}:${deviceId}`;
  const existingId = sessionByRoundAndDevice.get(key);

  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) return existing;
  }

  const session: Session = {
    id: randomId(),
    roundId: round.id,
    deviceId,
    startedAt: now,
    questionCount: 0,
    hintUsed: false,
    solved: false,
    solvedAt: null
  };

  sessions.set(session.id, session);
  sessionByRoundAndDevice.set(key, session.id);
  questionEvents.set(session.id, []);
  return session;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function getSessionState(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const events = questionEvents.get(sessionId) ?? [];
  return {
    session: {
      id: session.id,
      roundId: session.roundId,
      startedAt: session.startedAt,
      questionCount: session.questionCount,
      hintUsed: session.hintUsed,
      solved: session.solved,
      solvedAt: session.solvedAt
    },
    questions: events
  };
}

export function askQuestion(
  sessionId: string,
  question: string,
  now = Date.now(),
  options: RoundOptions = {}
) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const round = getCurrentRound(now, options);
  if (!options.forceOpen && session.roundId !== round.id) throw new Error('SESSION_ROUND_MISMATCH');
  if (round.status !== 'open') throw new Error('ROUND_NOT_OPEN');
  if (session.solved) throw new Error('ALREADY_SOLVED');
  if (session.questionCount >= MAX_QUESTIONS) throw new Error('QUESTION_LIMIT_REACHED');

  const person = round.person;
  const { answerLabel, answerTextIs } = answerQuestionForPerson(question, person);

  session.questionCount += 1;
  const event: QuestionEvent = {
    sessionId,
    question,
    answerLabel,
    answerTextIs,
    createdAt: now
  };

  const events = questionEvents.get(sessionId) ?? [];
  events.push(event);
  questionEvents.set(sessionId, events);

  return {
    answerLabel,
    answerTextIs,
    questionCount: session.questionCount,
    remaining: Math.max(0, MAX_QUESTIONS - session.questionCount)
  };
}

export function useHint(sessionId: string, now = Date.now(), options: RoundOptions = {}) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const round = getCurrentRound(now, options);
  if (!options.forceOpen && session.roundId !== round.id) throw new Error('SESSION_ROUND_MISMATCH');
  if (round.status !== 'open') throw new Error('ROUND_NOT_OPEN');
  if (session.hintUsed) throw new Error('HINT_ALREADY_USED');

  session.hintUsed = true;
  return {
    hint: round.person.hintIs,
    hintUsed: true
  };
}

export function submitGuess(
  sessionId: string,
  guess: string,
  now = Date.now(),
  options: RoundOptions = {}
) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const round = getCurrentRound(now, options);
  if (!options.forceOpen && session.roundId !== round.id) throw new Error('SESSION_ROUND_MISMATCH');
  if (round.status !== 'open' && !session.solved) throw new Error('ROUND_NOT_OPEN');

  const correct = isCorrectGuess(guess, round.person);

  if (correct && !session.solved) {
    session.solved = true;
    session.solvedAt = now;
  }

  const reveal = session.solved || round.status === 'closed';

  return {
    correct,
    solved: session.solved,
    reveal,
    revealPerson: reveal
      ? {
          displayName: round.person.displayName,
          revealTextIs: round.person.revealTextIs,
          imageUrl: round.person.imageUrl
        }
      : null
  };
}

export function getLeaderboard(roundId: string) {
  const solvedForRound = [...sessions.values()].filter((s) => s.roundId === roundId && s.solved && s.solvedAt);

  return solvedForRound
    .map((s) => {
      const round = getCurrentRound(s.startedAt);
      return {
        sessionId: s.id,
        questionsUsed: s.questionCount,
        timeFromStartMs: (s.solvedAt ?? s.startedAt) - s.startedAt,
        timeFromOpenMs: (s.solvedAt ?? s.startedAt) - round.opensAt,
        solvedAt: s.solvedAt ?? s.startedAt
      };
    })
    .sort((a, b) => {
      if (a.questionsUsed !== b.questionsUsed) return a.questionsUsed - b.questionsUsed;
      if (a.timeFromStartMs !== b.timeFromStartMs) return a.timeFromStartMs - b.timeFromStartMs;
      if (a.timeFromOpenMs !== b.timeFromOpenMs) return a.timeFromOpenMs - b.timeFromOpenMs;
      return a.solvedAt - b.solvedAt;
    })
    .map((row, i) => ({ rank: i + 1, ...row }));
}
