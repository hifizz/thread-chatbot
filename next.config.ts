import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Fly/Docker 部署用 standalone 产物（.next/standalone + server.js）；
  // Vercel 会忽略该选项，Coolify/nixpacks 的 `next start` 也不受影响。
  output: "standalone",
  // 多实例滚动发布需要同一 release 的稳定 deploymentId：
  // Fly 同一镜像的所有 Machine 共享 FLY_IMAGE_REF；其他环境回退到显式变量。
  deploymentId:
    process.env.FLY_IMAGE_REF ?? process.env.NEXT_DEPLOYMENT_ID ?? undefined,
}

export default nextConfig
