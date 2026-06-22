FROM node:20-alpine
RUN corepack enable && corepack prepare yarn@4.7.0 --activate

WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .
RUN NODE_OPTIONS="--max-old-space-size=1700" yarn build

# Switch into the build output directory and install production deps
WORKDIR /app/.medusa/server
RUN yarn install

EXPOSE 9000
CMD ["yarn", "start"]
