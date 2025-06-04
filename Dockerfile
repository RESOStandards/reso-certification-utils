FROM node:slim@sha256:5ae787590295f944e7dc200bf54861bac09bf21b5fdb4c9b97aee7781b6d95a2

RUN apt-get update && apt-get install -y git openjdk-17-jre-headless

RUN git clone https://github.com/RESOStandards/web-api-commander --single-branch
RUN git clone https://github.com/RESOStandards/reso-certification-utils --single-branch --branch 220-optimize-record-hashes

# clean up
RUN apt-get remove -y git
RUN rm -rf web-api-commander/.git
RUN rm -rf reso-certification-utils/.git
RUN rm -rf /var/lib/apt/lists/*

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV RESO_SDK_PATH=/reso-certification-utils
ENV JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF8
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV NODE_OPTIONS=--max-old-space-size=8192

RUN echo "Web API Commander Path: ${WEB_API_COMMANDER_PATH}"
WORKDIR ${WEB_API_COMMANDER_PATH}
RUN ./gradlew --no-daemon clean jar

RUN echo "RESO SDK Path:: ${RESO_SDK_PATH}"
WORKDIR ${RESO_SDK_PATH}
RUN npm install
RUN npm i . -g

ENTRYPOINT ["reso-certification-utils"]