import { appraisalDatabase } from './appraisal-db';

export function scanJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function scanBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes)
    throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_BODY');
  let length = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('BODY_TOO_LARGE');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('INVALID_BODY');
  }
}
export async function scanRateLimit(
  request: Request,
  namespace: string,
  count: number,
  windowMs: number,
) {
  const address = (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0] ??
    'local'
  ).trim();
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address)),
  );
  const now = Date.now(),
    window = Math.floor(now / windowMs);
  const key = `${namespace}:${Array.from(hash.slice(0, 16), (v) => v.toString(16).padStart(2, '0')).join('')}:${window}`;
  const db = appraisalDatabase();
  await db
    .prepare('DELETE FROM appraisal_rate_limits WHERE expires_at <= ?')
    .bind(now)
    .run();
  const row = await db
    .prepare(
      'INSERT INTO appraisal_rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(key, (window + 2) * windowMs)
    .first<{ count: number }>();
  return (row?.count ?? count + 1) <= count;
}
