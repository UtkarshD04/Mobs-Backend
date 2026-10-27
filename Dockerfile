# Replaces the Nixpacks build (which downloads packages from cache.nixos.org and can stall).
# Dokploy: set the Backend app's Build Type to "Dockerfile".
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Same default as src/config/env.js; Dokploy's PORT env var overrides it.
EXPOSE 4000
CMD ["node", "server.js"]
