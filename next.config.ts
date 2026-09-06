import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Office 解析依赖 Node.js 文件/压缩能力，仅在服务端加载。
  serverExternalPackages: ["officeparser", "exceljs", "yauzl"],
}

export default nextConfig
