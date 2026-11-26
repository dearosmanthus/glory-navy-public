export function revealToolResult(element: HTMLElement | null) {
  if (!element) return;
  for (const table of element.querySelectorAll<HTMLElement>(
    '[data-slot="table-container"]',
  )) {
    table.scrollTop = 0;
  }
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'start' });
}
