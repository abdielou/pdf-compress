---
phase: 2
slug: file-input-and-progress-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | INP-01 | unit | `npx vitest run tests/drop-zone.test.ts -t "drag and drop"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | INP-02 | unit | `npx vitest run tests/drop-zone.test.ts -t "click to browse"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | INP-03 | unit | `npx vitest run tests/file-validation.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 1 | INP-04, INP-05, INP-06 | unit | `npx vitest run tests/target-config.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | PRG-01 | unit | `npx vitest run tests/progress.test.ts -t "status text"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | PRG-02 | unit | `npx vitest run tests/progress.test.ts -t "progress bar"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | PRG-03 | unit | `npx vitest run tests/app.test.ts -t "wasm loading"` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 2 | PRG-04 | unit | `npx vitest run tests/progress.test.ts -t "error"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install -D jsdom` — DOM test environment
- [ ] `tests/drop-zone.test.ts` — covers INP-01, INP-02
- [ ] `tests/file-validation.test.ts` — covers INP-03
- [ ] `tests/target-config.test.ts` — covers INP-04, INP-05, INP-06
- [ ] `tests/progress.test.ts` — covers PRG-01, PRG-02, PRG-04
- [ ] `tests/app.test.ts` — covers PRG-03 (WASM loading state)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual drag-drop feedback | INP-01 | CSS visual states can't be verified in jsdom | Drag a file over drop zone, verify highlight appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
