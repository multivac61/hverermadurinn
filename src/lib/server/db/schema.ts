import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const persons = sqliteTable('persons', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  slug: text('slug').notNull().unique(),
  descriptionIs: text('description_is').notNull(),
  imageUrl: text('image_url'),
  metadataJson: text('metadata_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const rounds = sqliteTable(
  'rounds',
  {
    id: text('id').primaryKey(),
    dateYmd: text('date_ymd').notNull().unique(),
    personId: text('person_id').notNull(),
    opensAtUtc: integer('opens_at_utc', { mode: 'timestamp_ms' }).notNull(),
    closesAtUtc: integer('closes_at_utc', { mode: 'timestamp_ms' }).notNull(),
    statusOverride: text('status_override'),
    hintTextIs: text('hint_text_is'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('idx_rounds_date_ymd').on(t.dateYmd)]
);

export const deviceSessions = sqliteTable(
  'device_sessions',
  {
    id: text('id').primaryKey(),
    deviceIdHash: text('device_id_hash').notNull(),
    roundId: text('round_id').notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    questionCount: integer('question_count').notNull().default(0),
    hintUsed: integer('hint_used', { mode: 'boolean' }).notNull().default(false),
    solved: integer('solved', { mode: 'boolean' }).notNull().default(false),
    solvedAt: integer('solved_at', { mode: 'timestamp_ms' }),
    solveQuestionIndex: integer('solve_question_index')
  },
  (t) => [
    uniqueIndex('idx_device_sessions_device_round_unique').on(t.deviceIdHash, t.roundId),
    index('idx_device_sessions_round_solved').on(t.roundId, t.solved, t.solvedAt)
  ]
);

export const questionEvents = sqliteTable(
  'question_events',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').notNull(),
    sessionId: text('session_id').notNull(),
    questionText: text('question_text').notNull(),
    answerLabel: text('answer_label').notNull(),
    answerTextIs: text('answer_text_is').notNull(),
    latencyMs: integer('latency_ms'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('idx_question_events_session_created').on(t.sessionId, t.createdAt)]
);

export const guessEvents = sqliteTable(
  'guess_events',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id').notNull(),
    sessionId: text('session_id').notNull(),
    guessText: text('guess_text').notNull(),
    isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('idx_guess_events_session_created').on(t.sessionId, t.createdAt)]
);
