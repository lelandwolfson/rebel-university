# Rebel University: one small container.
FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

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
