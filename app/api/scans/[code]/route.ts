import { appraisalDatabase } from '@/lib/appraisal-db';
import { scanJson } from '@/lib/scan-api';

export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    if (!/^[a-f0-9]{24}$/.test(code))
      return scanJson({ error: 'SCAN_NOT_FOUND' }, 404);
    const row = await appraisalDatabase()
      .prepare(
        'SELECT payload, expires_at AS expiresAt FROM battle_scans WHERE code = ? AND expires_at > ?',
      )
      .bind(code, Date.now())
      .first<{ payload: string; expiresAt: number }>();
    if (!row) return scanJson({ error: 'SCAN_NOT_FOUND' }, 404);
    return scanJson({
      scan: JSON.parse(row.payload),
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  } catch {
    return scanJson({ error: 'LOAD_FAILED' }, 500);
  }
}
