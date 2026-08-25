# Stage 1: Build the Web API Commander JAR
FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS java-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git openjdk-17-jre-headless \
    && git clone https://github.com/RESOStandards/web-api-commander --single-branch --depth 1 \
    && rm -rf /var/lib/apt/lists/* /web-api-commander/.git
WORKDIR /web-api-commander
# Build the Commander, then drop the downloaded wrapper .zip. gradlew runs from the
# already-extracted dist (marked by its .ok file), so the ~130MB archive is dead weight once
# unpacked. Removing it shrinks the runtime image with no runtime re-download.
RUN ./gradlew --no-daemon clean jar \
    && find /root/.gradle/wrapper/dists -name '*.zip' -delete

# Stage 2: Install the RESO Certification Utils Node dependencies
FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS node-build
# git resolves the reso-certification-etl git dependency during npm install.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /reso-certification-utils
# Build from the checked-out source, not a re-clone, so the image reflects the branch being
# built. .dockerignore keeps node_modules, .git and results out of the build context.
COPY . /reso-certification-utils
RUN npm install && npm prune --omit=dev

# Stage 3: Final runtime image, only the JRE and the built artifacts, no build tools
FROM node:24-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
# apt-get upgrade patches the Debian base packages to the latest security level on top of
# the pinned digest, the pragmatic CVE-maintenance step for the shipped OS layer.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -m -s /bin/false appuser

# The metadata test runs the Commander via its Gradle wrapper at RUNTIME
# (lib/certification/data-dictionary/index.js spawns `gradlew testDataDictionary`), so the
# runtime image needs a working Gradle: the wrapper dist, the dependency cache, and the
# toolchain JDK Gradle auto-provisioned during the build. Ship the warmed Gradle home from
# the build stage into a writable GRADLE_USER_HOME owned by appuser, otherwise gradlew tries
# to bootstrap Gradle into a non-existent home at runtime and dies on the lock file.
# --chown copies and sets ownership in one layer (no separate chown -R bloat).
COPY --from=java-build --chown=appuser:appuser /web-api-commander /web-api-commander
COPY --from=node-build --chown=appuser:appuser /reso-certification-utils /reso-certification-utils
COPY --from=java-build --chown=appuser:appuser /root/.gradle /opt/gradle-home
ENV GRADLE_USER_HOME=/opt/gradle-home

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV RESO_SDK_PATH=/reso-certification-utils
ENV JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF8
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV NODE_OPTIONS=--max-old-space-size=8192

WORKDIR ${RESO_SDK_PATH}
# Link the CLI onto PATH and pre-create results/ so a non-root run can write output even
# without a bind mount.
RUN npm link && mkdir -p results && chown appuser:appuser results

USER appuser

ENTRYPOINT ["reso-certification-utils"]
