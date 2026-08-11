# RelayHub Working Agreement

## Discussion-to-document workflow

When a discussion with the user produces a durable project conclusion, update the most relevant document in this directory during the same turn.

Durable conclusions include:

- accepted product or architecture decisions;
- clarified component responsibilities or system boundaries;
- rejected alternatives and the reason for rejection;
- changes to roadmap order or acceptance criteria;
- implementation facts verified by code, tests, builds, or runtime checks;
- interview explanations that accurately reflect implemented behavior.

Do not copy the whole conversation into documentation. Distill it into concise project knowledge and label it as one of:

- `Accepted`: currently agreed direction;
- `Proposed`: useful idea that has not been implemented or approved;
- `Open question`: a decision still requiring evidence or user input;
- `Implemented`: verified in the current codebase.

Update existing topic documents before creating a new document. Add an ADR when a decision materially changes architecture, data ownership, security, cost, or project scope. Keep `docs/07-implementation-status.md` limited to verified implementation facts.

Documentation updates do not authorize unrelated code changes. If a discussion changes implementation scope materially, record the decision and ask for direction before expanding the build.

## Verification, commit, and GitHub push

After every RelayHub code or documentation change:

1. Run verification proportional to the change and report the result.
2. Commit the completed RelayHub change with a focused message.
3. Codex owns design, implementation, verification, documentation, commit, and push for the current focused change.
4. Report both the commit SHA and push result to the user.

Do not leave submitted or completed RelayHub changes only in the local repository.

## Autonomous design and delivery workflow

RelayHub follows `docs/10-autonomous-development-workflow.md`.

- Codex is the single owner of product design, architecture, implementation, verification, documentation, commit, and GitHub push.
- Do not require the user to relay implementation prompts or coordinate a second developer.
- Work in one focused vertical slice at a time. Finish and verify the current slice before starting the next.
- Use a Work Item for large, risky, or multi-session changes when frozen scope and durable acceptance evidence add value. Small changes do not require ceremony.
- Preserve the modular-monolith boundaries and prefer the smallest coherent change over a generic workflow engine or speculative abstraction.
- Product and UX decisions must keep the interface concise, elegant, single-screen where practical, and consistent with RelayHub's clean-room UX baseline.
- A change is complete only when proportional verification passes, durable documentation is current, the focused commit is pushed to `origin/main`, `HEAD == origin/main`, and the worktree is clean.
