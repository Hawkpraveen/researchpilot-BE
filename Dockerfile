FROM node:22-bookworm-slim AS backend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-build /build/package.json ./package.json
COPY --from=backend-build /build/node_modules ./node_modules
COPY --from=backend-build /build/dist ./dist
COPY agent/pyproject.toml ./agent/pyproject.toml
COPY agent/app ./agent/app
RUN python3 -m venv /opt/agent-venv \
    && /opt/agent-venv/bin/pip install --no-cache-dir ./agent
COPY deploy/start.py ./deploy/start.py
COPY deploy/check_agent_compatibility.py ./deploy/check_agent_compatibility.py
RUN /opt/agent-venv/bin/python deploy/check_agent_compatibility.py
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 \
    AGENT_BASE_URL=http://127.0.0.1:8000 \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER node
EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/agent-venv/bin/python", "/app/deploy/start.py"]
