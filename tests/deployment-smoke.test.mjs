import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRelease } from '../scripts/smoke-production.mjs';

const commit = 'a'.repeat(40);
function server(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(url.searchParams.get('release'), commit);
    const routes = {
      '/': () => new Response('<title>Glory Navy</title>'),
      '/healthz': () => new Response('ok\n'),
      '/release.json': () => Response.json({ commit }),
      '/api/scans/000000000000000000000000': () => Response.json({ error: 'SCAN_NOT_FOUND' }, { status: 404 }),
      ...overrides,
    };
    return routes[url.pathname]();
  };
}

test('release check validates website, exact commit and a database-backed missing scan', async () => {
  await verifyRelease('https://example.test', commit, server());
});
test('healthy old deployment cannot pass release verification', async () => {
  await assert.rejects(verifyRelease('https://example.test', commit, server({
    '/release.json': () => Response.json({ commit: 'b'.repeat(40) }),
  })), /expected release/);
});
test('healthy Worker with broken database fails deployment check', async () => {
  await assert.rejects(verifyRelease('https://example.test', commit, server({
    '/api/scans/000000000000000000000000': () => Response.json({ error: 'LOAD_FAILED' }, { status: 500 }),
  })), /D1/);
});
test('generic proxy 404 is not accepted as a working D1 API', async () => {
  await assert.rejects(verifyRelease('https://example.test', commit, server({
    '/api/scans/000000000000000000000000': () => Response.json({ error: 'NOT_FOUND' }, { status: 404 }),
  })), /D1/);
});
test('unexpected landing page fails even if health and release are valid', async () => {
  await assert.rejects(verifyRelease('https://example.test', commit, server({
    '/': () => new Response('Maintenance'),
  })), /Homepage/);
});
