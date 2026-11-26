import { appraisalDatabase } from '@/lib/appraisal-db';
import { validateScanSnapshot, SCAN_MAX_SHARE_BYTES } from '@/lib/battle-scan';
import { scanBody, scanJson, scanRateLimit } from '@/lib/scan-api';

export const dynamic = 'force-dynamic';
const LIFETIME = 30 * 24 * 60 * 60 * 1000;
export async function POST(request: Request) {
  try {
    const payload = validateScanSnapshot(
      await scanBody(request, SCAN_MAX_SHARE_BYTES),
    );
    if (!payload) return scanJson({ error: 'INVALID_SCAN' }, 400);
    if (!(await scanRateLimit(request, 'scan-share', 30, 60 * 60 * 1000)))
      return scanJson({ error: 'RATE_LIMIT' }, 429);
    const db = appraisalDatabase(),
      now = Date.now(),
      expiresAt = new Date(now + LIFETIME).toISOString();
    await db
      .prepare('DELETE FROM battle_scans WHERE expires_at <= ?')
      .bind(now)
      .run();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = [...crypto.getRandomValues(new Uint8Array(12))]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      const result = await db
        .prepare(
          'INSERT OR IGNORE INTO battle_scans (code, payload, created_at, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(code, JSON.stringify(payload), now, now + LIFETIME)
        .run();
      if (result.meta.changes === 1) return scanJson({ code, expiresAt }, 201);
    }
    return scanJson({ error: 'SAVE_FAILED' }, 500);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'BODY_TOO_LARGE') return scanJson({ error: code }, 413);
    if (code === 'INVALID_BODY') return scanJson({ error: code }, 400);
    console.error('Scan save failed');
    return scanJson({ error: 'SAVE_FAILED' }, 500);
  }
}
