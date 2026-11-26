/** Preserve this module's API error codes so its bilingual UI can explain failures. */
export async function scanFetch<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  init.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('REQUEST_TIMEOUT')),
    timeoutMs,
  );
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    if (!response.ok) {
      const code =
        typeof body?.error === 'string' && /^[A-Z_]{1,60}$/.test(body.error)
          ? body.error
          : response.status === 429
            ? 'RATE_LIMIT'
            : 'REQUEST_FAILED';
      throw new Error(code);
    }
    if (!body) throw new Error('INVALID_RESPONSE');
    return body as T;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}
