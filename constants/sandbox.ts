// 容器沙箱（Apple container，实验特性）相关常量。
// 每个 Demo artifact 对应一个轻量 VM，里面跑真正的 next dev；
// 文件通过 `container cp` 写入 VM 内文件系统（原生 inotify，HMR 生效）。

export const SANDBOX_IMAGE = "thread-chat-sandbox:base"
export const SANDBOX_NAME_PREFIX = "tc-sbx-"
export const SANDBOX_DEMO_DIR = "/srv/app/demo"
export const SANDBOX_PORT = 3000

/** 构建镜像时的 npm registry（国内网络默认 npmmirror），可用环境变量覆盖 */
export const SANDBOX_NPM_REGISTRY =
  process.env.SANDBOX_NPM_REGISTRY ?? "https://registry.npmmirror.com"

/** 沙箱 VM 资源配置 */
export const SANDBOX_CPUS = "4"
export const SANDBOX_MEMORY = "2g"

/** 前端轮询就绪的间隔与上限（next dev 首次编译可能要十几秒） */
export const SANDBOX_POLL_INTERVAL_MS = 2000
export const SANDBOX_POLL_MAX_ATTEMPTS = 60
