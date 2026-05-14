FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run -w @internal/shared build && npm run -w @internal/api build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --omit=dev
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
EXPOSE 4000
CMD ["npm", "run", "-w", "@internal/api", "start"]
