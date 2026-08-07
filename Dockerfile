FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY db/migrations ./migrations
COPY --from=frontend-build /build/frontend/dist ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
