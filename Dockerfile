# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:22-alpine
ENV NODE_ENV=production \
    QBO_CREDENTIAL_MODE=local \
    QBO_CREDENTIAL_FILE=/data/credentials.json
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
# Credentials live on a volume mounted at /data (writable by the runtime uid)
RUN mkdir /data && chown 65532:65532 /data
USER 65532:65532
EXPOSE 8080
CMD ["node", "dist/http.js"]
