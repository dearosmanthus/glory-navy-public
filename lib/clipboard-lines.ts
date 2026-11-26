export type ClipboardLine = {
  text: string;
  line: number;
  start: number;
  end: number;
};

export function locateClipboardLines(
  input: string,
  unmatched: string[],
): ClipboardLine[] {
  const remaining = new Map<string, number>();
  for (const text of unmatched)
    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  const parts = input.split(/(\r?\n)/);
  const result: ClipboardLine[] = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i];
    const count = remaining.get(text) ?? 0;
    if (count > 0) {
      result.push({
        text,
        line: i / 2 + 1,
        start: offset,
        end: offset + text.length,
      });
      remaining.set(text, count - 1);
    }
    offset += text.length + (parts[i + 1]?.length ?? 0);
  }
  return result;
}
