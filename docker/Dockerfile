# Build stage
FROM denoland/deno:latest AS builder

WORKDIR /app

COPY deno.json .
COPY api/ ./api/
COPY bot/ ./bot/

# api
WORKDIR /app/api

RUN deno cache src/index.ts

# bot
WORKDIR /app/bot

RUN deno cache src/main.ts

# Production stage api
FROM denoland/deno:latest AS api

WORKDIR /app/api

COPY --from=builder /deno-dir /deno-dir
COPY --from=builder /app /app

# Specify the command to run on container start
CMD ["serve", "-A", "src/index.ts"]

# Production stage bot
FROM denoland/deno:latest AS bot

WORKDIR /app/bot

COPY --from=builder /deno-dir /deno-dir
COPY --from=builder /app /app

# Specify the command to run on container start
CMD ["run", "-A", "src/main.ts"]
