# 代码工作台·容器沙箱基础镜像：Next.js 模板 + 预装依赖烘焙进镜像，
# 运行期不挂载宿主目录（AI 生成的文件通过 `container cp` 写入 /srv/app/demo，
# VM 内原生 inotify 保证 next dev HMR 生效）。
FROM node:22-bookworm-slim

WORKDIR /srv/app

# 国内网络默认走 npmmirror，可用 --build-arg NPM_REGISTRY=... 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0

COPY template/package.json ./package.json
RUN npm install --registry=${NPM_REGISTRY} --no-audit --no-fund

COPY template/ ./

EXPOSE 3000
CMD ["npm", "run", "dev"]
