# Render Free deployment

Deploy the Node API and Python agent in **one Docker web service**. The agent
submodule pins a revision of the independent agent repository. Only the API is
public; the agent binds to loopback on port 8000. No LLM weights run here.

## 1. Publish the deployment files

Commit and push the backend changes, including `.gitmodules`, the `agent`
submodule pointer, `.dockerignore`, `Dockerfile`, `deploy/`, and the host binding
changes. The agent revision must already be pushed to its own GitHub repository.
Never commit `.env` files or credentials.

For a fresh backend checkout:

```sh
git submodule update --init --recursive
```

Render checks out submodules automatically. Authorize its GitHub integration to
read **both** repositories, especially if the agent repository is private.

## 2. Create the web service

In Render, select **New > Web Service**, connect GitHub, and select the backend
repository (not the frontend or agent repository).

| Setting | Value |
| --- | --- |
| Name | `researchpilot-api` (or another available name) |
| Branch | The branch containing the committed deployment files |
| Region | Prefer the same region as MongoDB, where available |
| Language / Runtime | Docker |
| Root directory | Empty: backend repository root |
| Dockerfile path | `./Dockerfile` |
| Docker build context | Repository root (`.`), if requested |
| Docker command | Leave empty; use the image's default command |
| Instance type | **Free** |
| Health check path | `/api/v1/health` |

Do not configure a separate build or start command: Dockerfile and its CMD own
these steps. Do not create a paid private service, worker, or disk.

## 3. Environment variables

Add these in Render before deploying:

| Name | Value |
| --- | --- |
| `WEB_ORIGIN` | `https://researchpilot-fe.praveen-pk200109.workers.dev` (no trailing slash) |
| `MONGODB_URI` | Your Atlas application connection string, including the intended database name |
| `TAVILY_API_KEY` | Your Tavily free-plan API key |

The image already sets `NODE_ENV=production`, `HOST=0.0.0.0`, and a default
`PORT=10000`. Render's PORT is respected. The launcher fixes the internal
`AGENT_BASE_URL=http://127.0.0.1:8000` and overrides the agent's own HOST/PORT
without changing the API's public binding. No agent shared secret is required
for this loopback-only arrangement.

For Google/Microsoft sign-in, optionally add the matching public client IDs:
`GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID=common`.
Register the deployed frontend origin with Google and the frontend's
`/redirect.html` URL as a Microsoft SPA redirect. These IDs also need to be set
as the matching `VITE_*` build variables in Cloudflare. Email/password login
does not require either OAuth provider.

## 4. Allow Render to reach Atlas

Use MongoDB Atlas, not a laptop's `mongodb://127.0.0.1` connection string.
Create/use an application database user with access only to the application's
database. In Atlas Network Access, allow all outbound IP addresses/ranges
displayed by Render for this service. Do not use an allow-all rule as the default.
URL-encode special characters in connection-string passwords.

## 5. Deploy and connect the frontend

Open `https://YOUR-SERVICE.onrender.com/api/v1/health` and check for HTTP 200.
Logs should show the agent starting, MongoDB connecting, and the API listening.
The API starts only after the agent health endpoint responds. If either service
exits, the launcher stops its sibling and exits unsuccessfully, allowing Render
to restart the container. The agent port is not exposed publicly.

In **Cloudflare > app > Settings > Build > Variables and secrets**, set:

```env
VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com/api/v1
VITE_DEMO_MODE=false
VITE_RESEARCH_DEMO_MODE=false
```

Rebuild/redeploy the frontend. Register/login, then configure the model in
workspace Settings. For Groq Free, use the custom OpenAI-compatible provider,
BYOK mode, endpoint `https://api.groq.com/openai/v1`, your Groq key, and an
available model supporting JSON output. Test compatibility with a small research
job; supported models and free quotas change. LLM credentials are workspace
settings, not new Render environment variables. Never use the laptop's Ollama
localhost URL from a hosted service.

## Free-tier operation and updates

- Use one instance. Job orchestration and rate limits currently assume one API
  process; running jobs fail on an API restart and require an explicit retry.
- Render Free sleeps after 15 minutes without inbound traffic. Cold starts can
  take about a minute. First open the health URL and allow startup to finish.
- The free instance has limited memory shared by Node and Python. This container
  uses one Uvicorn worker and loads no local ML model. Actual memory and research
  concurrency must be checked on Render; reduce workload if it runs out of memory.
- The filesystem is temporary. Application records remain in Atlas.
- Leave the account without a payment method for a strict no-spend demo. Usage
  exhaustion can suspend services/builds. Free tiers are not uptime guarantees.
- Agent-only commits do not trigger a backend deployment. Update its pinned
  revision, commit the pointer in the backend, and push:

```sh
git -C agent fetch origin
git -C agent checkout <PUSHED_AGENT_COMMIT_SHA>
git add agent
git commit -m "Update deployed research agent"
git push
```

## Verification status

The backend build and tests and agent tests can run locally. A full image build
requires Docker or the first Render build; no Docker engine is installed in the
current workspace. Combined memory fit on Render Free has not been measured.

## Provider references

- https://render.com/docs/git-provider#git-submodules
- https://render.com/docs/docker
- https://render.com/docs/web-services#port-binding
- https://render.com/docs/free
- https://console.groq.com/docs/openai
