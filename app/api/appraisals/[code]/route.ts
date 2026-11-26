import { appraisalDatabase } from '@/lib/appraisal-db';

export const dynamic = 'force-dynamic';

function missing() {
  return Response.json(
    { error: '这个分享估价不存在或已经过期。' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function findAppraisal(code: string) {
  if (!/^[a-f0-9]{12}$/i.test(code)) return null;
  const database = appraisalDatabase();
  const now = Date.now();
  const row = await database.prepare(`
    SELECT payload, expires_at AS expiresAt
    FROM appraisals
    WHERE code = ?
  `).bind(code.toLowerCase()).first<{ payload: string; expiresAt: number }>();
  if (!row) return null;
  if (row.expiresAt <= now) {
    await database.prepare('DELETE FROM appraisals WHERE code = ?').bind(code.toLowerCase()).run();
    return null;
  }
  return row.payload;
}

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const payload = await findAppraisal(code);
    if (!payload) return missing();
    return new Response(payload, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Could not load appraisal share', error);
    return Response.json(
      { error: '分享估价读取失败。' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function HEAD(request: Request, context: { params: Promise<{ code: string }> }) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}
