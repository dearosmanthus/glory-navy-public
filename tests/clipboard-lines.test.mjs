import assert from 'node:assert/strict';
import test from 'node:test';
import { locateClipboardLines } from '../lib/clipboard-lines.ts';

test('an unknown name never selects a substring of a valid item row', () => {
  const input = 'Tritanium 1\nTrit';
  assert.deepEqual(locateClipboardLines(input, ['Trit']), [
    { text: 'Trit', line: 2, start: 12, end: 16 },
  ]);
});

test('duplicate errors retain distinct source lines and CRLF character offsets', () => {
  const input = '\r\n  错误物品  \r\nTritanium 1\r\n  错误物品  ';
  const found = locateClipboardLines(input, ['  错误物品  ', '  错误物品  ']);
  assert.deepEqual(
    found.map((row) => row.line),
    [2, 4],
  );
  assert.notEqual(found[0].start, found[1].start);
  for (const row of found)
    assert.equal(input.slice(row.start, row.end), row.text);
});

test('unknown or stale error text never points at another line', () => {
  assert.deepEqual(
    locateClipboardLines('Tritanium 1\nPyerite 5', ['Trit', 'Missing']),
    [],
  );
});
