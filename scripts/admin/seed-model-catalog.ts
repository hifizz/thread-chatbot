import { seedModelCatalog } from "../../lib/model-catalog/seed"
await seedModelCatalog()
console.log("模型目录初始化完成；已有配置未覆盖。")
process.exit(0)
