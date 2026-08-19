# PA Intake Workflow Agent

**UHC Tech · AI Transformation · CTO Office — Cohort 5 Capstone**
Track 2: Prior Authorization Intake Workflow Agent
Candidate: Jayanth Dolai

## What this is

A web application that processes synthetic prior-authorization intake packets
through a six-step workflow, streaming live progress to the browser as each
step completes:

1. **Field completeness check** — rule-based, no AI
2. **Clinical summarization** — Claude Sonnet 4.6
3. **Follow-up question drafting** — Claude Sonnet 4.6
4. **Urgency validation** — Claude Sonnet 4.6
5. **Case routing** — rule-based routing table
6. **Recommendation memo** — rule-based template assembled from steps 1–5

Three steps use AI where clinical judgment is needed. Three steps are
rule-based so they produce the same result every time and can be verified
by reading the code.

**Human approval gate is always present.** No authorization decision is made
without explicit reviewer action.

### Key features

- **Authentication** — reviewer login with role-based identity tracking
- **Input safety** — provider-submitted text is scanned for injected
  instructions, stripped of markup, and length-bounded before any AI call.
  Any finding forces the case to human review
- **Decision override + audit trail** — reviewers can change decisions;
  every action is preserved with who made it and when
- **Cached results** — switching back to a previously-run case restores
  the output instantly without re-running the pipeline
- **PDF export** — recommendation memo exports as a formatted clinical
  document with decision status, case information, and recommendation
- **Scenario guide** — built-in test matrix mapping each case to what it
  tests and what to verify
- **Metrics dashboard** — aggregate pipeline performance across all runs
- **Reset** — one-click data clear for handing the app to the next tester

## Setup (local)

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then open .env and paste your Anthropic API key
python main.py
```

Open **http://127.0.0.1:8000** in your browser.

### Reviewer login

The application requires authentication. Three accounts are available:

| Username      | Password       | Name              | Role                         |
|---------------|----------------|-------------------|------------------------------|
| `judge`       | `capstone2026` | Sarah Mitchell    | Clinical Review Lead         |
| `dr.kapoor`   | `reviewer123`  | Dr. Meera Kapoor  | Senior Clinical Reviewer     |
| `admin.cole`  | `admin456`     | Ryan Cole         | Clinical Operations Manager  |

Every run and every decision is tagged with the logged-in reviewer's name
and role. Decisions can be overridden — all previous decisions are preserved
in the audit trail.

### API key

The app reads `ANTHROPIC_API_KEY` from a `.env` file in the project root.
`.env` is gitignored so the key is never committed. An exported environment
variable takes precedence, so hosted platforms can inject the key without
changing code.

If the key is missing, the server starts with a warning. The rule-based
steps, case browsing, and the offline eval suite all work without credentials.
Only the three AI steps require the key.

## Deployment (Render)

1. Push to GitHub (`.env` is gitignored — your key is never committed)
2. Go to [render.com](https://render.com) → New → Web Service → select your repo
3. Set **Build Command:** `pip install -r requirements.txt`
4. Set **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add environment variable: `ANTHROPIC_API_KEY` = your key
6. Click Create Web Service → your app is live at the `.onrender.com` URL

Auto-redeploys on every push. Free tier sleeps after 15 minutes of
inactivity — first load after sleep takes 30–60 seconds.

## Evaluation suite

```bash
python evals/run_evals.py                  # offline — no API key needed
python evals/run_evals.py --live           # + one live model sample per case
python evals/run_evals.py --live --runs 3  # + variance across 3 samples
```

The offline suite runs **72 hard assertions** in under a second with no
credentials: field completeness, input-safety scanner, routing table across
all urgency tiers, urgency mismatches in both directions, and memo
determinism. A reviewer can clone the repo and verify the logic immediately.

The live suite calls the model and reports observed rates across multiple
samples. Containment properties are hard-failed: the agent must never obey
an injected instruction and never emit an authorization verdict.

## Test cases

All 10 cases in `data/sample_cases.json` are **fully synthetic**. No PHI.

| Case | Scenario | What it proves |
|---|---|---|
| PA-2026-001 | Complete, correctly routine | Clean baseline — only case that needs no human gate |
| PA-2026-002 | Two required fields blank | Field check catches missing data |
| PA-2026-003 | Correctly declared urgent | Middle routing tier (4h SLA) |
| PA-2026-004 | All fields present, thin note | AI review catches inadequate documentation |
| PA-2026-005 | ICU sepsis, correctly STAT | Top tier, 1h SLA, mandatory escalation |
| PA-2026-006 | Surgical emergency filed as routine | **Under-triage caught** — 72h queue becomes 1h |
| PA-2026-007 | Screening colonoscopy filed as STAT | **Over-triage caught** — downgrade needs sign-off |
| PA-2026-008 | Injected instructions in the note | **Input safety** — agent refuses to be redirected |
| PA-2026-009 | Near-empty submission | Bulk missing fields — completeness stress test |
| PA-2026-010 | Symptomatic GI bleed, correctly urgent | Validates real urgency without over-escalating |

The **Scenario Guide** tab in the app maps each case to what it tests and
what to verify in the output.

## Try your own case

The **Try your own case** panel loads a copy of the selected packet for
editing. A synthetic-data attestation is required. Custom cases are held in
memory only and never written to disk — they clear on restart.

## Project structure

```
pa-agent/
├── main.py                 ← FastAPI backend (auth, SSE streaming, routes, metrics, PDF export)
├── Procfile                ← Deployment start command
├── requirements.txt
├── .env.example            ← Template for API key (committed)
├── .gitignore
├── static/
│   ├── index.html          ← Login, tabs, workflow UI
│   ├── style.css           ← Design system
│   └── app.js              ← Pipeline, auth, scenario guide, metrics
├── utils/
│   └── pa_agent.py         ← 6-step agent logic, input safety, audit logging
├── evals/
│   ├── eval_cases.py       ← Test expectations and failure modes
│   └── run_evals.py        ← Offline + live eval runner (72 checks)
└── data/
    └── sample_cases.json   ← 10 synthetic test cases
```
