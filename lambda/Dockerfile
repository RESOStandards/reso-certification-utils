# Install deps in a node image (git is needed for the github dependency @reso/reso-certification-etl),
# then copy node_modules into the Lambda runtime image.
# Build from the repo root: docker build -f lambda/Dockerfile -t reso-cert-backup .

FROM node:22-slim AS build
WORKDIR /build
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

FROM public.ecr.aws/lambda/nodejs:22
WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=build /build/node_modules ./node_modules
COPY package.json ./
COPY common.js ./
COPY lib ./lib
COPY lambda ./lambda

CMD ["lambda/handler.handler"]
