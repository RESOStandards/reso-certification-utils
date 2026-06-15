# Stage 1: Build Java JAR
FROM node:slim@sha256:5ae787590295f944e7dc200bf54861bac09bf21b5fdb4c9b97aee7781b6d95a2 AS java-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git openjdk-17-jre-headless \
    && git clone https://github.com/RESOStandards/web-api-commander --single-branch --depth 1 \
    && rm -rf /var/lib/apt/lists/* /web-api-commander/.git
WORKDIR /web-api-commander
RUN ./gradlew --no-daemon clean jar

# Stage 2: Install Node dependencies
FROM node:slim@sha256:5ae787590295f944e7dc200bf54861bac09bf21b5fdb4c9b97aee7781b6d95a2 AS node-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && git clone https://github.com/RESOStandards/reso-certification-utils --single-branch --branch v3.0.0 --depth 1 \
    && rm -rf /var/lib/apt/lists/* /reso-certification-utils/.git
WORKDIR /reso-certification-utils
RUN npm install

# Stage 3: Final runtime image — no git or build tools, only the JRE needed at runtime
FROM node:slim@sha256:5ae787590295f944e7dc200bf54861bac09bf21b5fdb4c9b97aee7781b6d95a2
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

COPY --from=java-build /web-api-commander /web-api-commander
COPY --from=node-build /reso-certification-utils /reso-certification-utils

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV RESO_SDK_PATH=/reso-certification-utils
ENV JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF8
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV NODE_OPTIONS=--max-old-space-size=8192

WORKDIR ${RESO_SDK_PATH}
RUN npm link

RUN useradd -r -s /bin/false appuser
USER appuser

ENTRYPOINT ["reso-certification-utils"]
