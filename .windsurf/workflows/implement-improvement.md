---
description: Implement one improvement step from the docs/implementation-flowchart.md
---

## How to implement a step from the improvement plan

Use this workflow whenever the user says "implement step X" or "let's do step X".

### 1. Read the plan
Read the target step section in `docs/implementation-flowchart.md`.
Extract: files to modify, dependencies, risk level, exact logic described.

### 2. Read the full improvement detail
Read the corresponding section in `docs/ai-improvements.md` for the complete
picture — problem statement, proposed solution, pseudo-code, edge cases.

### 3. Read the files to be modified
Always read the exact lines to be changed before editing.
Never guess indentation, variable names, or existing structure.

### 4. Implement — minimal and focused
- Edit only the files listed in the flowchart for this step.
- Match the existing code style exactly (spacing, quote style, comment style).
- Do not refactor surrounding code unless it directly blocks the change.
- If the step touches a prompt string, update every rule number reference if needed.
- If the step introduces a new function, place it near its call site.

### 5. Verify syntax
```
node --check <modified_file> && echo "✅ OK"
```
Run for every JS file modified. Do not proceed if this fails.

### 6. Manual test checklist (share with user)
After every implementation, provide a short copy-pastable test checklist:
- What to load in the browser (URL or action)
- What to press / say
- What the expected behaviour change is
- What the old behaviour was (regression baseline)

### 7. Update docs — always, never skip
- `docs/implementation-flowchart.md`: add `✅ DONE` to the step in both the
  phase box and the `###` section heading. Add the commit message used.
- `docs/ai-improvements.md`: add `✅ IMPLEMENTED` to the section heading and
  a one-line note of what file was changed.

### 8. Commit with structured message
```
git add <changed files>
git commit -m "feat: <step-id> <step-name> — <one-line summary>"
git push
```
Format: `feat: 1A prompt improvements — scroll, wait, recovery, no-hallucinate rules`

### Improvements to this rule
- **One step at a time.** Never bundle two improvement steps in one commit.
- **Dependencies first.** Check the dependency graph in `implementation-flowchart.md`
  before starting — if the step requires a prior step, implement that first.
- **Risk awareness.** Steps marked High risk require a fallback path (try/catch,
  feature flag, or graceful degradation) before the happy path.
- **Prompt changes are free.** Prompt-only changes (no logic) have zero regression
  risk. Implement these first within any phase.
- **Measure the delta.** For each step, the test checklist must include a way to
  confirm the old problem is gone — not just that the new code runs.
