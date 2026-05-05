# Capability Design Doc — Template

> Copy this file to `docs/capabilities/<capability-name>.md` when starting a new capability design.
> Fill every section. Sections marked **[REQUIRED]** must be present before V3gga approval.

---

## 1. Scope **[REQUIRED]**

What this capability does. One paragraph, plain English, no jargon. End with the runtime contract in one sentence ("After X happens, Y is invoked, returning Z").

## 2. Scope ceiling — what this explicitly does NOT do **[REQUIRED]**

Bullet list of things a reader might assume are in scope but are deferred. Each bullet should name the deferred thing and (briefly) why. Trip-wires (binding constraints for future turns) go here.

## 3. Data structures and engine changes **[REQUIRED]**

New files (full paths). Engine changes (file + line region + nature of change). Public-API changes (signatures before/after).

## 4. Test surface **[REQUIRED]**

Where unit tests live. Where MD-driven corpus coverage lives. What the smoke-run command will be.

## 5. Complexity budget **[REQUIRED]**

Binding LOC budgets per file. **Disambiguation rules (binding for all future capability design docs):**

- **LOC = non-comment, non-blank lines.** Lines that are pure whitespace, pure `//` / `/*…*/` / `#` / docstring content do NOT count.
- **Code-with-trailing-comment counts as 1 LOC.** (`const x = 1; // explain` is 1 LOC.)
- **Multiline string literals count as code.**
- **Comment density expectation:** if a file is expected to be doc-heavy (e.g., contract surface, public API, design-anchor module), state the expected comment-to-code ratio explicitly here (e.g., "expected ~40% comment density"). Reviewers should not surprise themselves with overruns from heavy doc blocks.
- **Test files have their own budget line.** Don't roll them into module total.
- **Net delta budgets** (for edits to existing files) count added LOC minus deleted LOC, again non-comment / non-blank.

If a budget is busted, **stop and report.** Do not silently exceed. Reporting must include:
- file-by-file actual vs. cap (code-LOC, comment-LOC, total)
- whether the bust is comment-dominant or code-dominant
- what would need to come out to fit

Also: **0 new dependencies** is a default constraint. Any dep addition is a separate explicit decision.

## 6. Sub-capabilities / predicates / handlers **[REQUIRED]**

List every named sub-element with its derivation rules and check semantics. Mark which are this-turn-only and which are deferred-but-registration-pathway-reserved.

## 7. Risks and known limitations **[REQUIRED]**

What can go wrong. What WILL go wrong but is acceptable this turn. Trip-wires that future capability work must respect. **Include a "Known limitations — <integration-point> adoption" sub-section if the capability depends on cooperation from existing engine surfaces (e.g., does every strategy honor the new hint? does every code path call the new hook?).** This is where anti-pattern #13-style "infrastructure exists but isn't actually wired everywhere" risks get named.

## 8. Confidence ratings **[REQUIRED]**

Self-rated confidence (high / med / low) on each named claim or prediction in the doc. Calibration is tracked across turns.

## 9. Open questions / decisions needed from V3gga **[REQUIRED at draft, REMOVED at finalization]**

Numbered list. Each question gets V3gga's answer inline once decided, then the section is renamed "Final decisions" and locked.

## 10. Pre-implementation predictions **[REQUIRED if capability has corpus impact]**

Predicted fail→pass flips, predicted regressions, predicted bleed-passing cases. With confidence. Filed BEFORE the build runs so post-build reality is comparable.

---

## Process notes (binding)

- Design doc finalized ⇒ pause for V3gga approval before writing code.
- Implementation complete ⇒ verify with `tsc --noEmit`, corpus lint, unit tests, and an active-corpus regression check vs. the prior baseline. Report results.
- After implementation: revisit §10 predictions vs. actual. Both numbers stay in the doc as a calibration record.
- Anti-patterns observed during implementation get filed in `docs/anti-patterns.md` and (if generalizable) into the deferred-capabilities list.
