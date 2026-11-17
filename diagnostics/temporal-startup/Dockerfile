FROM node:22.20-bookworm-slim
# nginx in the production image brings libssl. The isolated probe needs it for
# the matching Prisma engine, without installing or starting nginx itself.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
LABEL trendpostiz.startup-image="test-only"
