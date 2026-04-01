---
phase: 1
slug: compression-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | vitest.config.ts (needs creation — Wave 0) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (WASM integration tests need longer timeouts) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | ENG-01 | integration | `npx vitest run tests/worker-init.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | ENG-03 | unit | `npx vitest run tests/engine.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | ENG-04 | unit | `npx vitest run tests/engine.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | ENG-05 | unit | `npx vitest run tests/controller.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-05 | 01 | 1 | ENG-06 | integration | `npx vitest run tests/ghostscript.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-06 | 01 | 1 | ENG-07 | unit | `npx vitest run tests/worker-protocol.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-07 | 01 | 1 | ENG-02 | smoke | Manual — verify worker spawns in main.ts | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest config with vite-plugin-wasm, worker support
- [ ] `npm install -D vitest @vitest/web-worker` — framework install
- [ ] `tests/engine.test.ts` — binary search logic with mocked GS module
- [ ] `tests/controller.test.ts` — controller skip logic, queue management
- [ ] `tests/worker-protocol.test.ts` — message type validation, transferable usage
- [ ] `tests/ghostscript.test.ts` — WASM integration (requires actual module)
- [ ] `tests/worker-init.test.ts` — worker spawns and reports ready

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WASM begins downloading on page load | ENG-02 | Requires browser network tab observation | Open page, check Network tab for gs.wasm request before any user interaction |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
