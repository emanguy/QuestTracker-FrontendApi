FROM node:8-alpine as buildContainer

RUN mkdir -p /srv/
WORKDIR /srv/

COPY types ./types
COPY package.json yarn.lock tsconfig.json ./
COPY src ./src

RUN apk update && \
    apk add python make g++ && \
    yarn install && \
    yarn run build

####################################

FROM node:8-alpine

RUN mkdir -p /srv/
WORKDIR /srv/
COPY --from=buildContainer /srv/build/ /srv/build/
COPY --from=buildContainer /srv/node_modules/ /srv/node_modules/
EXPOSE 80
ENV NODE_ENV production

CMD node build/index.js