import type { Person } from '$lib/server/game';
import { answerQuestionForPerson } from '$lib/server/game';

type EnvLike = {
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
};

type AnswerLabel = 'yes' | 'no' | 'unknown' | 'probably_yes' | 'probably_no';

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

function buildSystemPrompt() {
  return [
    'Role: You are the game master for "Hver er maðurinn?".',
    'Language: Always answer in Icelandic.',
    'Task: Answer the user question about the hidden person with a short yes/no style response.',
    'Never reveal or confirm the person name directly.',
    'Gender questions are allowed; answer them normally.',
    'If input is unclear, use unknown.',
    'Output STRICT JSON only: {"answerLabel":"yes|no|unknown|probably_yes|probably_no","answerTextIs":"short icelandic sentence"}.',
    'Keep answerTextIs to one short sentence.'
  ].join('\n');
}

function buildUserPrompt(question: string, person: Person) {
  return [
    `Target person name: ${person.displayName}`,
    `Known aliases: ${person.aliases.join(', ')}`,
    `Bio: ${person.revealTextIs}`,
    `Hint: ${person.hintIs}`,
    `Question: ${question}`
  ].join('\n');
}

async function askGemini(question: string, person: Person, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const model = env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const response = await fetch(url, {
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

  if (!response.ok) return null;
  const data = (await response.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  const answerLabel = normalizeLabel(String(parsed.answerLabel ?? 'unknown'));
  const answerTextIs = String(parsed.answerTextIs ?? '').trim() || 'Ég er ekki viss — geturðu spurt aðeins skýrar?';

  return { answerLabel, answerTextIs };
}

async function askOpenAiCompatible(question: string, person: Person, env: EnvLike) {
  const key = env.LLM_API_KEY;
  if (!key) return null;

  const baseUrl = env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = env.LLM_MODEL || 'gpt-4o-mini';

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
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

  if (!response.ok) return null;
  const data = (await response.json()) as any;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return null;

  const parsed = extractJson(text);
  if (!parsed) return null;

  const answerLabel = normalizeLabel(String(parsed.answerLabel ?? 'unknown'));
  const answerTextIs = String(parsed.answerTextIs ?? '').trim() || 'Ég er ekki viss — geturðu spurt aðeins skýrar?';

  return { answerLabel, answerTextIs };
}

export async function answerQuestionWithLlm(input: {
  question: string;
  person: Person;
  env: EnvLike | undefined;
}) {
  const { question, person, env } = input;

  if (!env?.LLM_API_KEY) return answerQuestionForPerson(question, person);

  const provider = (env.LLM_PROVIDER || 'gemini').toLowerCase();

  try {
    if (provider === 'gemini') {
      const result = await askGemini(question, person, env);
      if (result) {
        return result;
      }
    }

    if (provider === 'openai' || provider === 'openai-compatible' || provider === 'kimi') {
      const result = await askOpenAiCompatible(question, person, env);
      if (result) {
        return result;
      }
    }
  } catch {
    // fallback below
  }

  return answerQuestionForPerson(question, person);
}
