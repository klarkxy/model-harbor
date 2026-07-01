# ManageYourLLM 生产镜像（多阶段构建）
# Stage 1：安装全部依赖并构建；Stage 2：仅保留生产依赖与构建产物。

# ---------- builder ----------
FROM node:22-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/contracts/package.json ./packages/contracts/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------- production ----------
FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/contracts/package.json ./packages/contracts/

RUN pnpm install --frozen-lockfile --prod

# 复制构建产物
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist

# 数据、日志、备份默认挂载点
RUN mkdir -p /app/data /app/logs /app/backups

# 非 root 运行
RUN groupadd -r manageyourllm && useradd -r -g manageyourllm manageyourllm
RUN chown -R manageyourllm:manageyourllm /app/data /app/logs /app/backups
USER manageyourllm

EXPOSE 5420

CMD ["node", "apps/api/dist/main.js"]
