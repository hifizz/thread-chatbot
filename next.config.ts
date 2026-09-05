import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // 仅开发服务器：允许受监督的本地浏览器验收加载 JS/HMR。
  allowedDevOrigins: ["terminal.local"],
}

export default nextConfig
