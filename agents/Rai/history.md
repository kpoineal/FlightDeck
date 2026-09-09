# Rai — History

## Learnings

Initial scaffold via `squad upgrade`. Ready for work.

### 2026-09-08 - Inbox Parity RAI and Safety Review

- Issued a Red blocking verdict because scanner deletion preserves effectful proposals as `auditOnly`, but proposal transitions and Action Queue execution do not enforce read-only behavior. A fully valid audit-only queued or retryable proposal still exposes create/retry external-action commands after its source thread is deleted.
- Viper authored the rejected scanner-deletion audit-detachment artifact and is locked out for the next revision cycle. Maverick is the required fix owner; Rai re-review is mandatory.
- Native Electron confirmation, exact one-to-one Teams target resolution, observed-evidence gating, uncertain-send audit evidence, transactional scanner deletion, tombstones, operation guards, persistence rollback, and reload recovery all passed review.
- Proposal synthesis has explicit untrusted-data instructions and bounded context. Scanner and monitor prompts retain a pre-existing Yellow prompt-injection exposure because source-derived fields are interpolated without an equivalent data-not-instructions boundary; prompt surfaces were unchanged and require separate approval before semantic edits.
- Focused safety validation passed 68/68, and protected prompt surfaces had no worktree diff.
