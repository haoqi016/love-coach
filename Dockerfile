FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY --from=build /app ./

EXPOSE 8787
CMD ["node", "--env-file-if-exists=.env", "apps/server/dist/index.js"]
