# Tool workflow and responsive layout

The shared `app/workflow.css` keeps the same navigation order across all five tools, with compact mobile status and a six-button grid. Its header-clearance token is shared by anchor scrolling and desktop calculate buttons. Existing theme and calculations remain unchanged.

- LP only requests data after the initial hash has resolved; completed queries can be reused for two minutes when returning to LP. Manual refresh still fetches again. Market loading is distinguished from missing prices, and an empty search has a clear-search action.
- LP and contract result rows keep a single table markup/data source. On narrow screens the cells become labeled cards with efficiency/profit or split value/recommendation first; all other columns remain visible.
- Successful appraisal, industry and reprocessing calculations focus their totals. Pagination resets the nested table scroll position as well as revealing the new page.
- Contract sharing, copy actions and share feedback sit with the totals. Unrecognized lines retain exact source line numbers and character offsets, including repeated rows and CRLF input, and can be selected in the original textarea.
- Industry puts its shopping list before scheduling. Reprocessing puts output quantities and their copy action before the item-by-item breakdown. Mobile forms repeat the same primary action at the bottom.
- Reprocessing input/settings changes cancel the request and clear its busy state. Database failures have a separate retry state which editing the input cannot hide.
- New Battle Scan resets automatic input detection and focuses the editor. Mobile summaries grow with their content up to a bounded height; desktop summaries retain the three-column layout.

Checks: TypeScript, targeted Oxlint, `node --test tests/clipboard-lines.test.mjs`, `npm run test:scan`, `npm run test:industry`, production build and deployed HTTP/asset verification. No browser interaction or screenshot QA was performed in this pass.
