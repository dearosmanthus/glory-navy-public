export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const localized = (zh: string, en: string) => typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? en : zh;
  const controller = new AbortController();
  const cancel = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) cancel();
  init.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(localized('数据源响应超时，请重试。', 'The data source timed out. Please retry.'), 'TimeoutError')), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(localized(`数据请求失败（${response.status}），请稍后重试。`, `Data request failed (${response.status}). Please retry later.`));
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}
