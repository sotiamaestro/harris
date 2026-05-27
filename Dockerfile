FROM node:20-slim AS build

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/codebase/package.json ./packages/codebase/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/gemini/package.json ./packages/gemini/package.json
COPY packages/orchestrator/package.json ./packages/orchestrator/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm -r run build

FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV="production"
ENV CODEBASE_PATH="/workspace/codebase"
ENV HARRIS_AUDIT_DIR="/workspace/codebase/.harris/audit"
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules

VOLUME ["/workspace/codebase", "/workspace/codebase/.harris"]

ENTRYPOINT ["node", "packages/orchestrator/dist/index.js"]
