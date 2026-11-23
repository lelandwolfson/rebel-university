# Rebel University: one small container.
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

# su-exec: drop from root to the node user after fixing volume ownership (scripts/entrypoint.sh)
RUN apk add --no-cache su-exec

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
COPY data ./data

COPY scripts/entrypoint.sh /usr/local/bin/ru-entrypoint

# Starts as root only to chown the mounted volume, then runs the app as "node".
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/ru-entrypoint"]
CMD ["node", "src/server.js"]
