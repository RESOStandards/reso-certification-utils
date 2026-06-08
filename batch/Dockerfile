# AWS Batch image for the long-running (>15-min) backup path. Runs the same engine as the
# Lambda, just packaged as a container. Build from the repo root:
#   docker buildx build --provenance=false --sbom=false --platform linux/arm64 --load \
#     -f batch/Dockerfile -t reso-cert-backup-batch .
#
# git is needed to install the @reso/reso-certification-etl github dependency.

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
# --ignore-scripts: the repo's `prepare` runs `lefthook install` (a devDep) which fails in CI.
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json common.js index.js ./
COPY lib ./lib
COPY batch ./batch
# Scratch space for the on-disk backup tree before upload (override with WORK_DIR).
RUN mkdir -p /data && chown node:node /data
USER node
ENTRYPOINT ["node", "batch/entry.js"]
