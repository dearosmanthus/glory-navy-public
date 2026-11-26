import { appraisalDatabase } from '@/lib/appraisal-db';
import { validateAppraisal } from '@/lib/appraisal-payload';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 512 * 1024;
const APPRAISAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 60 * 60 * 1000;
const RATE_LIMIT_COUNT = 30;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function requestKey(request: Request) {
  const address = (request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]
    ?? 'unknown').trim();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest).slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function withinRateLimit(request: Request) {
  const database = appraisalDatabase();
  const now = Date.now();
  await database.batch([
    database.prepare('DELETE FROM appraisals WHERE expires_at <= ?').bind(now),
    database.prepare('DELETE FROM appraisal_rate_limits WHERE expires_at <= ?').bind(now),
  ]);
  const window = Math.floor(now / RATE_LIMIT_MS);
  const key = `${await requestKey(request)}:${window}`;
  const result = await database.prepare(`
    INSERT INTO appraisal_rate_limits (key, count, expires_at)
    VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1
    RETURNING count
  `).bind(key, (window + 2) * RATE_LIMIT_MS).first<{ count: number }>();
  return (result?.count ?? RATE_LIMIT_COUNT + 1) <= RATE_LIMIT_COUNT;
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_BODY_BYTES) return json({ error: '估价内容过大。' }, 413);

    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) return json({ error: '估价内容过大。' }, 413);

    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      return json({ error: '估价数据格式无效。' }, 400);
    }
    const payload = validateAppraisal(raw);
    if (!payload) return json({ error: '估价数据格式无效。' }, 400);
    if (!(await withinRateLimit(request))) return json({ error: '分享链接创建过于频繁，请稍后再试。' }, 429);

    const database = appraisalDatabase();
    const createdAtMs = Date.now();
    const createdAt = new Date(createdAtMs).toISOString();
    const storedPayload = JSON.stringify({ ...payload, createdAt });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createCode();
      try {
        await database.prepare(`
          INSERT INTO appraisals (code, payload, created_at, expires_at)
          VALUES (?, ?, ?, ?)
        `).bind(code, storedPayload, createdAtMs, createdAtMs + APPRAISAL_LIFETIME_MS).run();
        return json({ code, createdAt }, 201);
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    return json({ error: '分享链接创建失败。' }, 500);
  } catch (error) {
    console.error('Could not create appraisal share', error);
    return json({ error: '分享链接创建失败。' }, 500);
  }
}
