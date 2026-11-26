import { env } from 'cloudflare:workers';

type AppraisalBindings = {
  DB?: D1Database;
};

export function appraisalDatabase() {
  const database = (env as unknown as AppraisalBindings).DB;
  if (!database) throw new Error('D1 database binding DB is unavailable.');
  return database;
}
