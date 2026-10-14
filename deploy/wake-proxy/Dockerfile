# The wake-proxy uses only Node's built-in modules, so there is nothing to install.
FROM node:22-alpine
WORKDIR /app
COPY server.js ./
USER node
# Listens on 8080; Tailscale Funnel on this host proxies 443 → 127.0.0.1:8080.
ENV LISTEN_PORT=8080
CMD ["node", "server.js"]
