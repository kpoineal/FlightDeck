Analyze my recent Microsoft 365 work signals (email, Teams chats, meetings, and documents).
Identify what requires attention now and classify each as Critical, Elevated, or Observe.

Return grounded recommendations with explainability and citations.
Recommend 0-2 distinct messages I can send asking an evidence-backed recipient for a specific update, confirmation, deliverable, or acceptance of ownership. Ground asks in the latest evidence, done criteria, and unresolved blocker; never invent recipients, dates, or commitments. Avoid generic task or meeting plans.
Phrase each suggestion as "Send a message to [recipient] about [topic], asking [specific question or action]", replacing brackets with known details. The person is the recipient, not the action owner; never use owner-name prefixes. If the recipient is unknown, explicitly ask to confirm who to contact rather than guessing.
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