import type { Person } from '$lib/server/game';

type EnvLike = {
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
};

type AnswerLabel = 'yes' | 'no' | 'unknown' | 'probably_yes' | 'probably_no';

type LlmAnswer = {
  answerLabel: AnswerLabel;
  answerTextIs: string;
};

type InputIntent = 'question' | 'guess' | 'hint';


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
    'Role: You are the strict game master for "Hver er maðurinn?".',
    'Language: Always answer in Icelandic.',
    'You must answer clearly and briefly (one short sentence).',
    'Prefer direct labels: yes/no whenever possible; use unknown only when evidence is genuinely insufficient.',
    'For factual binary questions (e.g. nationality/profession), avoid unknown unless the provided facts truly do not decide it.',
    'Never reveal or confirm the exact person name directly.',
    'Gender questions are allowed and should be answered normally.',
    'Examples:',
    '- Q: "Er manneskjan íslendingur?" -> {"answerLabel":"yes","answerTextIs":"Já."} or {"answerLabel":"no","answerTextIs":"Nei."}',
    '- Q: "Er hún tónlistarkona?" -> short yes/no/unknown based on facts.',
    'Output STRICT JSON only: {"answerLabel":"yes|no|unknown|probably_yes|probably_no","answerTextIs":"short icelandic sentence"}.',
    'Do not output markdown or any text outside JSON.'
  ].join('\n');
}

function buildUserPrompt(question: string, person: Person) {
  return [
    `Target person name: ${person.displayName}`,
    `Known aliases: ${person.aliases.join(', ')}`,
    `Known nationality flag (is Icelandic): ${person.isIcelander ? 'yes' : 'no'}`,
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
    'Use hint if player asks for hint/help.',
    'Use guess if player attempts to name the person.',
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

async function askGemini(question: string, person: Person, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const model = env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const response = await fetchWithOneRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(question, person) }] }],
      generationConfig: {
        temperature: 0.2,
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
      temperature: 0.2,
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

  const model = env.LLM_MODEL || 'gemini-2.5-flash-lite';
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
  const model = env.LLM_MODEL || 'gpt-4o-mini';

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

  const lower = raw.toLowerCase();
  if (['vísbending', 'visbending', 'hint', 'hjálp', 'hjalp'].includes(lower)) {
    return { kind: 'hint' };
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
  const fallback: LlmAnswer = { answerLabel: 'unknown', answerTextIs: 'Ekki viss.' };

  if (!env?.LLM_API_KEY) {
    logLlm('fallback_no_api_key', { provider: env?.LLM_PROVIDER ?? 'none', question });
    return { answerLabel: 'unknown', answerTextIs: 'LLM ekki stillt.' };
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
  return fallback;
}
