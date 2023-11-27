FROM node:21-alpine3.17

RUN apk add --update bash git openjdk11 && rm -rf /var/cache/apk/*

RUN git clone https://github.com/RESOStandards/web-api-commander --single-branch

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV NODE_OPTIONS=--max-old-space-size=8192

ADD ./ ./

RUN echo 'Web API Commander Path: ${WEB_API_COMMANDER_PATH}'

WORKDIR ${WEB_API_COMMANDER_PATH}
RUN ./gradlew --no-daemon clean jar

WORKDIR /
RUN npm install
RUN npm i . -g

ENTRYPOINT [ "reso-certification-utils" ]
