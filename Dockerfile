FROM alpine:latest

RUN apk add --update bash nodejs npm git openjdk11 && rm -rf /var/cache/apk/*

RUN git clone https://github.com/RESOStandards/web-api-commander --single-branch

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV ARGS=--help

ADD ./ ./

RUN echo "Web API Commander Path: ${WEB_API_COMMANDER_PATH}"

WORKDIR ${WEB_API_COMMANDER_PATH}
#RUN ./gradlew --no-daemon clean build

WORKDIR /
RUN npm i -g

ENTRYPOINT [ "/bin/sh" ]
