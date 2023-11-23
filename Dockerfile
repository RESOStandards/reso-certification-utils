FROM node:21-alpine3.17

RUN apk add --update bash npm git openjdk11 && rm -rf /var/cache/apk/*

RUN git clone https://github.com/RESOStandards/web-api-commander --single-branch

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV ARGS=--help

ADD ./ ./

RUN echo "Web API Commander Path: ${WEB_API_COMMANDER_PATH}"

WORKDIR ${WEB_API_COMMANDER_PATH}
RUN ./gradlew --no-daemon clean jar

WORKDIR /
RUN npm install

ENTRYPOINT [ "/bin/sh" ]
