# ResearchPilot API

Node.js and Express API for ResearchPilot. This repository is intentionally
separate from the web client and Python agent.

## Current status

This repository separates routes, controllers, services, repositories, models,
middleware, and configuration. It implements email/password account
registration and login with hashed passwords, revocable bearer sessions, and
per-user ownership checks for research jobs. Development and test environments
also expose a demo-session endpoint; it is disabled in production.

Backend logic uses plain functions and returned objects rather than classes.
Each controller folder's `index.ts` creates its Express router and defines its
endpoints. `routes/index.ts` is the global router that mounts those feature
routers under `/api/v1`.

The API also implements persistent research-job creation,
status/list/report reads, cancellation, persisted event replay over SSE, and
internal orchestration of the Agent's bounded planning and execution endpoints.
The Agent plan is validated and persisted by the API, then real web research
runs using the workspace's saved model settings. The API validates and stores
the returned source-linked report. Configure `TAVILY_API_KEY` in the Python
agent environment and your model in workspace Settings. Provider or evidence
failures fail the job; no placeholder report is generated. Historical planning
reports remain unchanged. Research requests use the depth's 60/180/300-second
budget plus transport grace; `AGENT_TIMEOUT_MS` controls the short planning call.

## Local development

Requires Node.js 20 or later.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

New accounts always receive the regular `user` role. No public registration
path can assign the reserved `super_admin` role.

The service binds to `127.0.0.1:5000`. Verify it at
`http://127.0.0.1:5000/api/v1/health`.
The API calls the private Agent at `AGENT_BASE_URL`, with a bounded timeout
controlled by `AGENT_TIMEOUT_MS`. The frontend must call only this API.
The frontend uses `POST /api/v1/auth/register` and `POST /api/v1/auth/login`,
then sends the returned bearer token for `/api/v1/auth/me`, logout, and
research-job requests. Sessions expire after seven days; only a hash of each
session token is stored in MongoDB. GitHub OAuth, phone OTP, 2FA, password
recovery, and email verification are not implemented yet. Google and Microsoft sign-in
are implemented through browser popups: Google Identity Services and MSAL
return ID tokens to the frontend, which posts them to `POST
/api/v1/auth/google` or `POST /api/v1/auth/microsoft`. The backend verifies the
tokens, creates or restores a session, and returns the usual bearer-session
response. These are JSON token endpoints, not webhooks or provider redirect
callbacks; `routes/index.ts` mounts the auth router under `/api/v1/auth`.

Set the same public Google and Microsoft client IDs in this API's `.env` and
the frontend's `VITE_GOOGLE_CLIENT_ID` and `VITE_MICROSOFT_CLIENT_ID`. Register
the frontend origin (`http://localhost:8080`) as a Google JavaScript origin
as well as the Microsoft SPA redirect URI (`http://localhost:8080/redirect.html`).
The MSAL redirect bridge is served without COOP headers; apply the matching
COOP policy only to the frontend application routes when deploying. Set `MICROSOFT_TENANT_ID` to
`common` for both personal and work/school Microsoft accounts.

The example database URL is local-only. Start MongoDB locally before starting
the API. No production database credentials or seed data are used.

## Research jobs

- `POST /api/v1/research-jobs` — validate and queue a bounded research request.
- `GET /api/v1/research-jobs` — list the latest 50 jobs.
- `GET /api/v1/research-jobs/:jobId` — read persisted job status.
- `GET /api/v1/research-jobs/:jobId/events` — replay persisted events and stream updates.
- `GET /api/v1/research-jobs/:jobId/report` — read the report after completion.
- `POST /api/v1/research-jobs/:jobId/cancel` — cancel an active job.

Run `npm test`, `npm run typecheck`, and `npm run build` to validate the API.
