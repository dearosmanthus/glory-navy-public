import { normalizeScanName } from '@/lib/battle-scan';
import { resolveScanMembers } from '@/lib/scan-affiliations';
import { scanBody, scanJson, scanRateLimit } from '@/lib/scan-api';
import { cachedJsonProxy } from '@/lib/edge-json';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const raw = await scanBody(request, 64 * 1024);
    if (
      !Array.isArray(raw) ||
      raw.length < 1 ||
      raw.length > 250 ||
      !raw.every(
        (name) =>
          typeof name === 'string' &&
          name.trim().length >= 2 &&
          name.length <= 100 &&
          !/[<>]/.test(name) &&
          !Array.from(name).some((char) => char.charCodeAt(0) < 32),
      )
    )
      return scanJson({ error: 'INVALID_NAMES' }, 400);
    const names = [
      ...new Map(
        raw.map((name: string) => [normalizeScanName(name), name.trim()]),
      ).values(),
    ].sort((a, b) => normalizeScanName(a).localeCompare(normalizeScanName(b)));
    if (!(await scanRateLimit(request, 'scan-characters', 60, 60 * 60 * 1000)))
      return scanJson({ error: 'RATE_LIMIT' }, 429);
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(names)),
      ),
    );
    const key = `scan-characters-v1:${[...hash].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return await cachedJsonProxy(request, key, 600, async () =>
      Response.json({ members: await resolveScanMembers(names) }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'BODY_TOO_LARGE') return scanJson({ error: code }, 413);
    if (code === 'INVALID_BODY') return scanJson({ error: code }, 400);
    // Do not log pasted names or the scan contents.
    console.error('Character affiliation lookup failed', code);
    return scanJson({ error: 'ESI_UNAVAILABLE' }, 502);
  }
}
