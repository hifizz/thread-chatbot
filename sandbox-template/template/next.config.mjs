import os from "node:os"

// 宿主浏览器通过容器 IP（192.168.64.x）访问，对 next dev 来说是跨源请求；
// Next 16 默认拦截跨源 dev 资源（客户端 chunk/HMR 全被拒，页面无法水合），
// 启动时枚举 VM 自身的对外 IPv4 加入白名单。
const vmAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((iface) => iface && !iface.internal && iface.family === "IPv4")
  .map((iface) => iface.address)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 预览 iframe 里不显示 Next.js 开发指示器
  devIndicators: false,
  allowedDevOrigins: vmAddresses,
}

export default nextConfig
