# Frontend: build the Vite SPA, then serve it via nginx (which also proxies /api).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# Our server config (SPA + /api proxy).
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
# Built SPA assets.
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
