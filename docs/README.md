# Documentation Index

Implementation specs for features built on top of the architecture in [`../plan.md`](../plan.md). Each doc is the contract between product intent and the code we write — read this first when picking up a feature.

## How to read this folder

- **`plan.md`** in the repo root is the strategic plan: tech stack, architecture, milestones, competitive research, anti-patterns. Keep it as the single source of truth for "what" and "why".
- **`docs/feat-*.md`** are implementation specs: schema diffs, API signatures, UI flow, test plan. Read these for "how".
- **`docs/architecture.md`** is the operational architecture overview (lighter than `plan.md` §2 — newcomer-friendly).
- **`docs/runbook.md`** is the on-call / ops procedures (when to do what when something breaks). Lives here once we ship.

## Feature specs

| # | Spec | Status | Milestone | Summary |
|---|---|---|---|---|
| 1 | [feat-selfie-metadata-validation.md](feat-selfie-metadata-validation.md) | Proposed | M4 | Capture image metadata at punch and cross-validate against device fingerprint + GPS to detect uploads of previously-taken photos. |
| 2 | [feat-selfie-watermark.md](feat-selfie-watermark.md) | Approved | M3 | Burn timestamp + GPS + device-fingerprint hash into the selfie image so a saved/shared photo is tamper-evident. |
| 3 | [feat-photo-compression.md](feat-photo-compression.md) | Approved | M3 | Resize and JPEG-compress selfies in the browser to ≤100 KB before upload — saves bandwidth & free-tier storage. |
| 4 | [feat-anomaly-detection.md](feat-anomaly-detection.md) | Approved | M5 | Server-side rules flag suspect punches; dashboard pane filters them for one-tap supervisor review. Notification delivery is mocked for v1. |
| 5 | [feat-site-of-day-briefing.md](feat-site-of-day-briefing.md) | Approved | M5/M6 | Supervisor writes a daily note + safety reminder; worker sees it above the Punch button on the punch screen. |
| 6 | [feat-daily-site-report.md](feat-daily-site-report.md) | Approved | M7 | Raken-style end-of-day report: weather, headcount, blockers, photos. Pulls headcount from attendance automatically. |
| 7 | [feat-forgotten-punchout.md](feat-forgotten-punchout.md) | Approved | M8 | Auto-close shifts left open at midnight site-time and surface them to the supervisor for one-tap adjustment before payroll export. |
| 8 | [feat-selfie-storage-lifecycle.md](feat-selfie-storage-lifecycle.md) | Approved | M8 | Retention rules + bulk cleanup tools + GDPR-style worker-data export & delete. |
| 9 | [feat-payroll-integration.md](feat-payroll-integration.md) | Mocked v1 | Post-MVP | Stubbed CSV export today; deeper integrations (Tally / QuickBooks / ADP / Gusto) for a later release. |

## Conventions

- **Status:** `Proposed` (in design) · `Approved` (ready to build) · `In-progress` · `Shipped` · `Deprecated`.
- **Each spec links back to `plan.md`** sections for strategic context — keep specs focused on the "how".
- **Schema diffs** in specs are authoritative. When implementing, copy the SQL into a new migration in `supabase/migrations/00NN_*.sql`, never edit existing ones.
- **Edge Function signatures** in specs are authoritative for request/response shapes. Update both spec and code in the same PR.
- **Update the status field** in the spec header when you change milestones — it's the freshness signal.
