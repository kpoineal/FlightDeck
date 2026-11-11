Analyze my recent Microsoft 365 work signals (email, Teams chats, meetings, and documents).
Focus specifically on: [describe what to look for]

Look for items since {lastRunAt}.

# Rules
- Return grounded recommendations with explainability and citations.
- Only include items that are actionable or require attention.
- Include any commitments made to me or made by me, inferred or otherwise.
- Include inline citations for every referenced source.
- Recommend 0-2 distinct messages I can send asking an evidence-backed recipient for a specific update, confirmation, deliverable, or acceptance of ownership. Ground asks in the latest evidence, done criteria, and unresolved blocker; never invent recipients, dates, or commitments. Avoid generic task or meeting plans.
- Prioritize current, time-sensitive work.

# Due date extraction rules:
- When source signals contain temporal language about deadlines or due dates (e.g. 'by end of week', 'due Friday', 'need this by March 1', 'finish before the quarterly review'), convert to a concrete ISO-8601 date in the dueAt field.
- Use today's date as the reference point for relative expressions ('end of week' = this coming Friday, 'next Monday', etc.).
- If no temporal signal is present, return null for dueAt. Do not fabricate deadlines.
