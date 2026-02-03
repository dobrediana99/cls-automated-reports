# Production Dockerfile for cls-automated-reports backend (Google Cloud Run).
# Build context: backend directory. Build: docker build -t cls-backend -f backend/Dockerfile backend

# Stage 1: install dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Stage 2: runner
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run sets PORT=8080; app uses process.env.PORT || 8080
EXPOSE 8080

COPY --from=deps /app/node_modules ./node_modules
COPY . .

CMD ["npm", "start"]
