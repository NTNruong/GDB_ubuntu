FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
RUN npm run -w @internal/shared build && npm run -w @internal/frontend build

FROM nginx:1.27-alpine AS runtime
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
