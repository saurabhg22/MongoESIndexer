FROM node:22-alpine

RUN apk add git

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./

ENV NODE_ENV production

RUN yarn global add @nestjs/cli

RUN yarn install --frozen-lockfile --production

COPY . .

RUN yarn build

CMD [ "node", "dist/src/main.js" ]