## 1. 内容与组件重组

- [x] 1.1 更新 `constants/landing.ts` 的类型和内容，集中定义编辑式首页文案、CTA、页脚链接、Hero slogan 及可替换视频路径。
- [x] 1.2 重写首页 section 组件，使其仅覆盖导航、Video Hero、产品声明、Why I built、Why not existing chat、CTA 和页脚。
- [x] 1.3 更新 `app/page.tsx` 的组件组合与首页 metadata，并移除旧首页 section 的引用和无用类型。

## 2. 视觉与响应式实现

- [x] 2.1 重写 landing scope 样式，采用 thread-chat 的暖黄、黑色、绿色 token 和无衬线字体栈，移除旧纸张网格、手绘及多色强调视觉。
- [x] 2.2 实现 16:9 Hero 视频壳、左下 slogan、静态缺省占位和无障碍替代文本。
- [x] 2.3 实现桌面窄文稿列与 375px 单列布局，确保导航、视频、文案和 CTA 不产生水平溢出。
- [x] 2.4 为主 CTA、链接和视频区域补齐键盘焦点与减少动态效果下的可读状态。

## 3. 验证与交付

- [x] 3.1 在桌面和 375px 宽度验证首页 section 顺序、Hero 比例、按钮触达和视频缺省状态。
- [ ] 3.2 运行 `pnpm typecheck`、`pnpm lint` 和 `pnpm build`，修复本变更引入的问题。
- [ ] 3.3 在用户提供 MP4 后，将文件放入 `public/` 并仅更新 landing 视频路径常量，复验自动播放与静态回退。
