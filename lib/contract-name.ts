export function normalizeContractName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .trim()
    // Some localized EVE clients mark copied item names with boundary asterisks.
    .replace(/^(?:\*\s*)+/, '')
    .replace(/(?:\s*\*)+$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}
