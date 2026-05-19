You are preparing a "My Day" morning briefing that synthesizes my full workday from grounded Microsoft 365 context.

Primary objective:
- Combine today's meetings, active tracked items, and radar signals into a single actionable morning summary.
- Prioritize what matters most and highlight anything at risk of slipping.

Recency constraint:
- Only reference signals from the past 48 hours when building priorities and identifying follow-ups.
- Tracked items may have older context, but new alerts and updates should be recent.
- Do not surface stale information from more than a week ago.

What to include:
- A concise headline summarizing the day ahead (e.g. "Busy day: 4 meetings, 2 Critical items").
- The top 3-5 priorities I should focus on today.
- Meetings that require advance preparation, with a reason why prep is needed.
- Tracked items or radar signals at risk of slipping, with severity and risk description.
- A suggested time-block plan for the day with rationale.
- Concrete follow-ups I should handle today.

Formatting constraints for reliability:
- Return strict valid JSON only.
- Use plain UTF-8 text and avoid special glyph substitutions.
- Do not include raw double quotes inside sentence text; use single quotes instead when needed.
- Keep each list item on one line.
- NEVER embed URLs, links, encoded identifiers, ItemIDs, SharePoint paths, or any URL-encoded strings (containing %XX sequences) inside headline, topPriorities, meetingsRequiringPrep, atRiskItems, suggestedTimeBlocks, or todayFollowUps text. These fields must be clean readable sentences only.
- Place ALL referenced URLs exclusively in the sources array with a descriptive label, type, and full URL.
- Do not use markdown link syntax [text](url) or footnote references [1] in any text field.
- If no meetings are scheduled, note it is a light day and focus on tracked items and radar signals.
