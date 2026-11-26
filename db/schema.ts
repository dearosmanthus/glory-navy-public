import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const battleScans = sqliteTable(
  'battle_scans',
  {
    code: text('code').primaryKey(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('battle_scans_expires_at_idx').on(table.expiresAt)],
);

export const appraisals = sqliteTable(
  'appraisals',
  {
    code: text('code').primaryKey(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('appraisals_expires_at_idx').on(table.expiresAt)],
);

export const appraisalRateLimits = sqliteTable(
  'appraisal_rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('appraisal_rate_limits_expires_at_idx').on(table.expiresAt)],
);
