Analyze my recent Microsoft 365 work signals (email, Teams chats, meetings, and documents).
Identify what requires attention now and classify each as Critical, Elevated, or Observe.

Return grounded recommendations with explainability and citations.
Only include items with signals created or updated since {lastRunAt}. Do not report older items.
Include inline citations for every referenced source.
Include 5-15 items.

Also include a commitments ledger in the same response.
Ledger recency rules:
- Prioritize current, time-sensitive work.
- Only include commitments with signals since {lastRunAt}.
- Exclude stale/closed items.

Due date extraction rules:
- When source signals contain temporal language about deadlines or due dates (e.g. 'by end of week', 'due Friday', 'need this by March 1', 'finish before the quarterly review'), convert to a concrete ISO-8601 date in the dueAt field.
- Use today's date as the reference point for relative expressions ('end of week' = this coming Friday, 'next Monday', etc.).
- If no temporal signal is present, return null for dueAt. Do not fabricate deadlines.