import { answerQuestionForPerson, type Person } from '$lib/server/game';

type EnvLike = {
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_INTENT_MODEL?: string;
  LLM_BASE_URL?: string;
};

type AnswerLabel = 'yes' | 'no' | 'unknown' | 'probably_yes' | 'probably_no';

type LlmAnswer = {
  answerLabel: AnswerLabel;
  answerTextIs: string;
};

export type InputIntent = 'question' | 'guess' | 'hint';

function normalizeLabel(value: string): AnswerLabel {
  const v = value.trim().toLowerCase();
  if (v === 'yes' || v === 'já') return 'yes';
  if (v === 'no' || v === 'nei') return 'no';
  if (v === 'probably_yes') return 'probably_yes';
  if (v === 'probably_no') return 'probably_no';
  return 'unknown';
}

function extractJson(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function shortAnswerFromLabel(label: AnswerLabel) {
  if (label === 'yes') return 'Já.';
  if (label === 'no') return 'Nei.';
  if (label === 'probably_yes') return 'Líklega já.';
  if (label === 'probably_no') return 'Líklega nei.';
  return 'Ekki viss.';
}

function normalizeAnswerText(answerLabel: AnswerLabel, rawText: string) {
  const cleaned = rawText.trim().replace(/\s+/g, ' ');
  const firstSentence = cleaned.split(/[.!?]\s/)[0]?.trim() ?? '';
  const candidate = firstSentence.length > 0 ? firstSentence : cleaned;

  if (!candidate) return shortAnswerFromLabel(answerLabel);

  const clipped = candidate.length > 90 ? `${candidate.slice(0, 89)}…` : candidate;
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asksAboutGender(question: string) {
  const q = normalizeText(question);
  return /\b(kyn|karl|kona|kk|kvk|male|female|he|she|hann|hun|hun)\b/.test(q);
}

function asksAboutLifeStatus(question: string) {
  const q = normalizeText(question);
  return /\b(lifandi|latinn|latin|daudur|daud|deceased|alive|dead)\b/.test(q);
}

function mentionsGender(answerText: string) {
  const a = normalizeText(answerText);
  return /\b(karl|kona|karlkyn|kvenkyn|male|female|he|she|hann|hun|hun)\b/.test(a);
}

function mentionsLifeStatus(answerText: string) {
  const a = normalizeText(answerText);
  return /\b(lifandi|latinn|latin|daudur|daud|deceased|alive|dead)\b/.test(a);
}

function enforceNoExtraSensitiveDisclosure(question: string, answer: LlmAnswer): LlmAnswer {
  const qGender = asksAboutGender(question);
  const qLife = asksAboutLifeStatus(question);

  if (!qGender && mentionsGender(answer.answerTextIs)) {
    return { ...answer, answerTextIs: shortAnswerFromLabel(answer.answerLabel) };
  }

  if (!qLife && mentionsLifeStatus(answer.answerTextIs)) {
    return { ...answer, answerTextIs: shortAnswerFromLabel(answer.answerLabel) };
  }

  return answer;
}

function logLlm(event: string, data: Record<string, unknown>) {
  console.log(`[llm] ${event}`, JSON.stringify(data));
}

async function fetchWithOneRetry(url: string, init: RequestInit) {
  const first = await fetch(url, init);
  if (first.status !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return fetch(url, init);
}

function buildSystemPrompt() {
  return [
    'Role: You are the witty but precise game master for "Hver er maðurinn?".',
    'Language: Always answer in Icelandic.',
    'Primary objective: answer the player\'s exact question intent, not a nearby interpretation.',
    'Interpretation rules:',
    '- Preserve polarity and negation exactly.',
    '- Example: Q="Er hún ekki forseti?" -> yes means she is NOT president.',
    '- If input is vague or not answerable from known facts, use unknown.',
    '- Never reveal or confirm the exact person name directly.',
    '- Gender questions are allowed and should be answered normally.',
    'Style rules:',
    '- One short sentence only (max ~12 words).',
    '- Start with a clear verdict word aligned with answerLabel.',
    '- Keep tone playful, clever, and kind (no sarcasm, no rudeness).',
    'Output STRICT JSON only: {"answerLabel":"yes|no|unknown|probably_yes|probably_no","answerTextIs":"short icelandic sentence"}.',
    'Do not output markdown or any text outside JSON.'
  ].join('\n');
}

function buildUserPrompt(question: string, person: Person) {
  const nationality =
    person.isIcelander === true ? 'yes' : person.isIcelander === false ? 'no' : 'unknown';

  return [
    `Target person name: ${person.displayName}`,
    `Known aliases: ${person.aliases.join(', ')}`,
    `Known nationality flag (is Icelandic): ${nationality}`,
    `Known yes-tags: ${person.yesKeywords.length ? person.yesKeywords.join(', ') : '(none provided)'}`,
    `Known no-tags: ${person.noKeywords.length ? person.noKeywords.join(', ') : '(none provided)'}`,
    `Bio: ${person.revealTextIs}`,
    `Hint: ${person.hintIs}`,
    `Question: ${question}`
  ].join('\n');
}

function buildIntentSystemPrompt() {
  return [
    'Role: classify one player input for the game "Hver er maðurinn?".',
    'Language: Icelandic game context.',
    'Return STRICT JSON only: {"kind":"question|guess|hint"}.',
    'Use hint if player asks for help or a hint (e.g. "vísbending", "má ég fá hjálp?").',
    'Use guess if player proposes a specific identity (e.g. "Er þetta Björk?", "Ég giska á ...", "Björk Guðmundsdóttir").',
    'Treat generic attribute checks as question (e.g. "Er þetta kona?" is question).',
    'Otherwise use question.',
    'No extra text outside JSON.'
  ].join('\n');
}

function normalizeIntent(value: string): InputIntent {
  const v = value.trim().toLowerCase();
  if (v === 'hint') return 'hint';
  if (v === 'guess') return 'guess';
  return 'question';
}

function isHintLike(text: string) {
  const n = normalizeText(text);
  if (!n) return false;

  if (/\b(visbending|hint)\b/.test(n)) return true;
  if (/\b(hjalp|hjalpa|help)\b/.test(n)) return true;

  return false;
}

const GENERIC_GUESS_OBJECT_TERMS = new Set([
  'manneskja',
  'persona',
  'personan',
  'madur',
  'maður',
  'kona',
  'karl',
  'karlmadur',
  'kvenmadur',
  'islendingur',
  'islensk',
  'islenskur',
  'tonlistarkona',
  'tonlistarmadur',
  'songkona',
  'songvari',
  'leikari',
  'forseti',
  'ithrottamadur',
  'lifandi',
  'latinn',
  'daudur',
  'daud'
]);

function hasUppercaseNameCue(text: string) {
  return /\b[A-ZÁÉÍÓÚÝÞÆÖ][a-záðéíóúýþæö]+\b/u.test(text);
}

export function extractGuessText(inputText: string) {
  let text = inputText.trim();

  const patterns = [
    /^(gisk|giska|guess)\s*:?\s*/i,
    /^(eg|ég)\s+giska\s+(a|á)\s*/i,
    /^(my\s+guess\s+is)\s*/i,
    /^(eg|ég)\s+held\s+ad\s+(thetta|þetta)\s+se\s*/i,
    /^(held\s+ad\s+(thetta|þetta)\s+se)\s*/i,
    /^(getur\s+(thetta|þetta|hann|hun|hún)\s+verid|getur\s+(thetta|þetta|hann|hun|hún)\s+verið)\s*/i,
    /^(er|is)\s+(thetta|þetta|hann|hun|hún)\s+/i,
    /^(heitir\s+(hann|hun|hún))\s+/i
  ];

  for (const pattern of patterns) {
    text = text.replace(pattern, '').trim();
  }

  text = text.replace(/[?.!]+$/g, '').trim();
  return text || inputText.trim();
}

function isGuessLike(text: string) {
  const n = normalizeText(text);
  if (!n) return false;

  if (/^(gisk|giska|guess)\b/.test(n)) return true;
  if (/\b(eg|ég)\s+giska\b/.test(n)) return true;
  if (/\b(my guess|i guess)\b/.test(n)) return true;
  if (/\b(held ad (thetta|þetta) se|getur (thetta|þetta) verid|getur (thetta|þetta) verið)\b/.test(n)) {
    return true;
  }

  if (/^(er|is)\s+(thetta|þetta|hann|hun|hún)\s+/.test(n)) {
    const candidate = normalizeText(extractGuessText(text));
    if (!candidate) return false;
    const tokens = candidate.split(' ').filter(Boolean);
    const allGeneric = tokens.length > 0 && tokens.every((token) => GENERIC_GUESS_OBJECT_TERMS.has(token));
    if (!allGeneric && (tokens.length >= 2 || hasUppercaseNameCue(text))) return true;
  }

  const trimmed = text.trim();
  const noQuestionMark = !trimmed.includes('?');
  if (noQuestionMark) {
    const candidate = normalizeText(trimmed);
    const tokens = candidate.split(' ').filter(Boolean);
    const hasQuestionVerb = /\b(er|eru|hvad|hvað|hver|hvar|hvenaer|hvenær|afhverju|af hverju|is|does|did|can)\b/.test(
      candidate
    );

    if (
      !hasQuestionVerb &&
      tokens.length >= 2 &&
      tokens.length <= 5 &&
      !tokens.every((token) => GENERIC_GUESS_OBJECT_TERMS.has(token))
    ) {
      return true;
    }
  }

  return false;
}

export function inferIntentHeuristically(raw: string): InputIntent | null {
  if (isHintLike(raw)) return 'hint';
  if (isGuessLike(raw)) return 'guess';
  return null;
}

async function askGemini(question: string, person: Person, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const model = env.LLM_MODEL || 'gemini-3-flash-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const response = await fetchWithOneRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(question, person) }] }],
      generationConfig: {
        temperature: 0.35,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    logLlm('gemini_http_error', { status: response.status });
    if (response.status === 429) throw new Error('LLM_RATE_LIMITED');
    if (response.status >= 500) throw new Error('LLM_UPSTREAM_ERROR');
    return null;
  }
  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    logLlm('gemini_no_text', { hasCandidates: Boolean(data?.candidates?.length) });
    return null;
  }

  const parsed = extractJson(text);
  if (!parsed) {
    logLlm('gemini_bad_json', { text: text.slice(0, 220) });
    return null;
  }

  const answerLabel = normalizeLabel(String(parsed.answerLabel ?? 'unknown'));
  const answerTextIs = normalizeAnswerText(answerLabel, String(parsed.answerTextIs ?? ''));

  return { answerLabel, answerTextIs };
}

async function askOpenAiCompatible(question: string, person: Person, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = env.LLM_MODEL || 'gpt-4o-mini';

  const response = await fetchWithOneRetry(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(question, person) }
      ]
    })
  });

  if (!response.ok) {
    logLlm('openai_http_error', { status: response.status });
    if (response.status === 429) throw new Error('LLM_RATE_LIMITED');
    if (response.status >= 500) throw new Error('LLM_UPSTREAM_ERROR');
    return null;
  }
  const data = (await response.json()) as any;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    logLlm('openai_no_text', { hasChoices: Boolean(data?.choices?.length) });
    return null;
  }

  const parsed = extractJson(text);
  if (!parsed) {
    logLlm('openai_bad_json', { text: text.slice(0, 220) });
    return null;
  }

  const answerLabel = normalizeLabel(String(parsed.answerLabel ?? 'unknown'));
  const answerTextIs = normalizeAnswerText(answerLabel, String(parsed.answerTextIs ?? ''));

  return { answerLabel, answerTextIs };
}

async function classifyWithGemini(inputText: string, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const model = env.LLM_INTENT_MODEL || env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const response = await fetchWithOneRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildIntentSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: `Input: ${inputText}` }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    logLlm('gemini_intent_http_error', { status: response.status });
    return null;
  }

  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  return normalizeIntent(String(parsed.kind ?? 'question'));
}

async function classifyWithOpenAiCompatible(inputText: string, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = env.LLM_INTENT_MODEL || env.LLM_MODEL || 'gpt-4o-mini';

  const response = await fetchWithOneRetry(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildIntentSystemPrompt() },
        { role: 'user', content: `Input: ${inputText}` }
      ]
    })
  });

  if (!response.ok) {
    logLlm('openai_intent_http_error', { status: response.status });
    return null;
  }

  const data = (await response.json()) as any;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  return normalizeIntent(String(parsed.kind ?? 'question'));
}

export async function classifyInputIntentWithLlm(input: {
  inputText: string;
  env: EnvLike | undefined;
}): Promise<{ kind: InputIntent }> {
  const raw = input.inputText.trim();
  if (!raw) return { kind: 'question' };

  const heuristicIntent = inferIntentHeuristically(raw);
  if (heuristicIntent) {
    return { kind: heuristicIntent };
  }

  if (!input.env?.LLM_API_KEY) {
    return { kind: 'question' };
  }

  const provider = (input.env.LLM_PROVIDER || 'gemini').toLowerCase();

  try {
    if (provider === 'gemini') {
      const kind = await classifyWithGemini(raw, input.env);
      if (kind) return { kind };
    }

    if (provider === 'openai' || provider === 'openai-compatible' || provider === 'kimi') {
      const kind = await classifyWithOpenAiCompatible(raw, input.env);
      if (kind) return { kind };
    }
  } catch (error) {
    logLlm('intent_exception', {
      provider,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return { kind: 'question' };
}

export async function answerQuestionWithLlm(input: {
  question: string;
  person: Person;
  env: EnvLike | undefined;
}): Promise<LlmAnswer> {
  const { question, person, env } = input;

  if (!env?.LLM_API_KEY) {
    logLlm('fallback_no_api_key', { provider: env?.LLM_PROVIDER ?? 'none', question });
    return answerQuestionForPerson(question, person);
  }

  const provider = (env.LLM_PROVIDER || 'gemini').toLowerCase();

  try {
    if (provider === 'gemini') {
      const result = await askGemini(question, person, env);
      if (result) {
        const safe = enforceNoExtraSensitiveDisclosure(question, result);
        logLlm('answer', { provider, question, answerLabel: safe.answerLabel, answerTextIs: safe.answerTextIs });
        return safe;
      }
    }

    if (provider === 'openai' || provider === 'openai-compatible' || provider === 'kimi') {
      const result = await askOpenAiCompatible(question, person, env);
      if (result) {
        const safe = enforceNoExtraSensitiveDisclosure(question, result);
        logLlm('answer', { provider, question, answerLabel: safe.answerLabel, answerTextIs: safe.answerTextIs });
        return safe;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logLlm('provider_exception', {
      provider,
      question,
      error: message
    });

    if (message === 'LLM_RATE_LIMITED' || message === 'LLM_UPSTREAM_ERROR') {
      throw new Error(message);
    }
  }

  logLlm('fallback_unknown', { provider, question });
  return answerQuestionForPerson(question, person);
}
