FROM node:21-alpine3.17

RUN apk add --update git openjdk17-jre-headless 

RUN git clone https://github.com/RESOStandards/web-api-commander --single-branch

# clean up
RUN apk del git
RUN rm -rf web-api-commander/.git
RUN rm -rf /var/cache/apk/*

ENV WEB_API_COMMANDER_PATH=/web-api-commander
ENV REFERENCE_METADATA_URL=https://services.reso.org/metadata
ENV NODE_OPTIONS=--max-old-space-size=8192

ADD ./ ./

RUN echo "Web API Commander Path: ${WEB_API_COMMANDER_PATH}"

WORKDIR ${WEB_API_COMMANDER_PATH}
RUN ./gradlew --no-daemon clean jar

WORKDIR /
RUN npm install
RUN npm i . -g

ENTRYPOINT ["reso-certification-utils"]
