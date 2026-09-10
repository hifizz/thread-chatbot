// 仅本地浏览器测试加载；产品不导入此文件，不提供改时钟接口。
const { readFileSync } = require("node:fs")
if (process.env.ADMIN_CATALOG_TEST_WRITES !== "1" || !process.env.ADMIN_TEST_CLOCK_FILE) throw new Error("需要显式启用隔离测试时钟")
const now = Date.now.bind(Date)
Date.now = () => now() + Number(readFileSync(process.env.ADMIN_TEST_CLOCK_FILE, "utf8"))
