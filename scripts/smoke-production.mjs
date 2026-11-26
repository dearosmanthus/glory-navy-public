import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export async function verifyRelease(origin, commit, fetcher = fetch) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('A full Git commit SHA is required.');
  async function request(path) {
    const url = new URL(path, origin);
    url.searchParams.set('release', commit);
    const response = await fetcher(url, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Glory-Navy-Release-Check' },
    });
    return response;
  }
  const [page, health, release, database] = await Promise.all([
    request('/'), request('/healthz'), request('/release.json'),
    // A valid-format missing code reaches the database query without storing any data.
    request('/api/scans/000000000000000000000000'),
  ]);
  if (page.status !== 200 || !/Glory Navy/i.test(await page.text())) throw new Error('Homepage is unavailable or unexpected.');
  if (health.status !== 200 || (await health.text()).trim() !== 'ok') throw new Error('Worker health check failed.');
  if (release.status !== 200 || (await release.json()).commit !== commit) throw new Error('The expected release is not serving yet.');
  if (database.status !== 404 || (await database.json()).error !== 'SCAN_NOT_FOUND') throw new Error('D1 binding/schema check failed.');
}

async function main() {
  const [commit, ...origins] = process.argv.slice(2);
  if (origins.length === 0) throw new Error('Provide at least one site origin to verify.');
  await Promise.all(origins.map(async (origin) => {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await verifyRelease(origin, commit);
        console.log(`PASS ${origin}: homepage, Worker, commit and D1`);
        return;
      } catch (error) {
        console.warn(`${origin}, attempt ${attempt}/6: ${error.message}`);
        if (attempt === 6) throw error;
        await sleep(5_000);
      }
    }
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`Production verification failed: ${error.message}`); process.exitCode = 1; });
}
