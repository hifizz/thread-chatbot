# syntax=docker/dockerfile:1
# ThreadChat Fly.io 镜像：同一 Dockerfile 产出 staging/production 共用的 release 镜像。
# 运行时只携带 Next standalone 产物；migration 不在容器启动时执行（见 scripts/fly-migrate.mjs）。

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# ---- deps：仅安装依赖，利用 lockfile 缓存 ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# ---- build：完整源码构建 standalone 产物 ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期不需要真实密钥；Next standalone 只打包运行时所需文件。
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- runner：最小运行时，非 root，机器即进程 ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
# standalone 产物已含裁剪后的 node_modules 与 server.js。
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
# SIGTERM 由 instrumentation 注册的 drain 钩子处理：关准入 → 有界收尾 → flush → 退出。
CMD ["node", "server.js"]
