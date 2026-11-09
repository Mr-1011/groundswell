# Groundswell chat server (agent/server.ts, unchanged) as a Vercel container function.
FROM node:24-slim
WORKDIR /app/agent
COPY app/agent/package.json app/agent/package-lock.json ./
RUN npm ci --omit=dev
COPY app/agent/ /app/agent/
COPY app/db/ /app/db/
# Read-only database: crafted SQL from the chat cannot change data. Root ignores file modes, so the server runs as "node".
RUN gunzip /app/db/groundswell.sqlite.gz && chmod 444 /app/db/* && chmod 555 /app/db
USER node
# HOME: the Claude binary writes its config there. PORT must match the PORT env var of the Vercel project.
ENV HOME=/tmp PORT=8080
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server.ts"]
