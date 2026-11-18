# Fixture plan for judge tests — not a real plan.

## Task Index

| # | Task | Depends on | Gate | Conductor |
|---|------|------------|------|-----------|
| 1 | plain task | — | — | Opus |
| 2 | gated task | 1 | OWNER REVIEW (process) | Opus |
| 3 | human task | 2 | gate (Owner step) | Opus |
| 4 | bare root task | — | — | Opus |

### Task 1: Plain
**Files:**
- Create: `src/foo.ts`, `src/{alpha,beta}.ts`, `src/glob-?.ts`, `.devin/skills/x/SKILL.md`
  and `foo.test.ts`
- Modify: `docs/decisions.md`

### Task 2: Gated
**Files:**
- Create: `src/bar.ts`

### Task 3: Human step
**Files:**
- Create: `src/baz.ts`

### Task 4: Bare root
**Files:**
- Modify: `scripts/conductor/devin.sh` (detach), `CLAUDE.md`, `docs/decisions.md`
