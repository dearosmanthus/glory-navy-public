import { proxyError } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';

const SERVICE_URL = 'https://hallogistics.space/';
const APPRAISAL_URL = `${SERVICE_URL}api/appraisal`;
const MAX_APPRAISAL_CHARACTERS = 100_000;
const MAX_APPRAISAL_LINES = 5_000;

function jsonError(error: string, status: number) {
  return Response.json(
    { success: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getXsrfCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.match(/(?:^|[,;]\s*)_xsrf=([^;,\s]+)/)?.[1] ?? '';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('请求内容不是有效的 JSON。', 400);
  }

  const appraisalText = typeof body === 'object' && body !== null && 'appraisal_text' in body
    ? (body as { appraisal_text?: unknown }).appraisal_text
    : null;
  if (typeof appraisalText !== 'string' || !appraisalText.trim()) {
    return jsonError('请先输入物品清单。', 400);
  }
  if (appraisalText.length > MAX_APPRAISAL_CHARACTERS || appraisalText.split(/\r?\n/).length > MAX_APPRAISAL_LINES) {
    return jsonError('物品清单过长，请拆分后重试。', 413);
  }

  try {
    const commonHeaders = {
      Accept: 'application/json',
      'User-Agent': 'Glory-Navy/1.0',
    };
    const landing = await fetch(SERVICE_URL, {
      headers: commonHeaders,
      signal: AbortSignal.timeout(8_000),
    });
    if (!landing.ok) throw new Error(`Appraisal session returned ${landing.status}`);

    const xsrf = getXsrfCookie(landing);
    if (!xsrf) throw new Error('Appraisal session did not provide an XSRF token');

    const upstream = await fetch(APPRAISAL_URL, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json',
        Cookie: `_xsrf=${xsrf}`,
        Origin: SERVICE_URL.slice(0, -1),
        Referer: SERVICE_URL,
        'X-XSRFToken': xsrf,
      },
      body: JSON.stringify({ appraisal_text: appraisalText.trim() }),
      signal: AbortSignal.timeout(25_000),
    });
    const contentType = upstream.headers.get('content-type') ?? '';
    const responseBody = await upstream.text();
    if (!contentType.includes('application/json')) {
      throw new Error(`Appraisal endpoint returned ${upstream.status} without JSON`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseBody);
    } catch {
      throw new Error(`Appraisal endpoint returned invalid JSON with status ${upstream.status}`);
    }

    return Response.json(payload, {
      status: upstream.status,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return proxyError(error);
  }
}
