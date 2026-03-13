FROM node:20-alpine AS build

WORKDIR /app

COPY web-app/package*.json ./
RUN npm ci

COPY web-app ./
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 1420
