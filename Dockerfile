# finchpad — single image that builds the Vite frontend and runs the API + indexer together.
# Node 22 ships node:sqlite (used by the indexer/backend) without extra flags on 22.17+.

# ---- build stage: install deps and build web/dist ----
FROM node:22-slim AS build
WORKDIR /app

# Root deps (viem). Copy lockfile first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Frontend deps.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund

# Source + build. VITE_* come from the committed .env.production (public values only);
# vite reads it via envDir="..".
COPY . .
RUN npm run web:build

# ---- runtime stage: slim image with only what serves traffic ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# App code, root node_modules (viem), and the built frontend. No vite / web devDeps ship.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/web/dist ./web/dist

EXPOSE 8787
CMD ["node", "scripts/start-prod.mjs"]
