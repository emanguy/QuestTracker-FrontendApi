FROM node:8-alpine

ADD types ./types
ADD package.json yarn.lock tsconfig.json ./
ADD src ./src

RUN apk update && \
    apk add python make g++ && \
    yarn install && \
    yarn run build

CMD yarn run start