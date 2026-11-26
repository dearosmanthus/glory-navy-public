# 协作与审阅 / Contributing

目标流程：功能分支 → Pull Request → 自动检查 → 维护者审阅 → 合并 → 再次检查。

## 开始修改

1. 按 README 安装并启动项目。
2. 从最新 `main` 建立功能分支，例如 `feature/industry-export`。每个 PR 聚焦一个可验证的改动，避免混入依赖升级、格式化和生成数据重建。
3. 修改页面时保持中英两种语言、手机布局、固定导航、旧分享链接与已有本地设置兼容。
4. 提交前运行 `npm run check` 和 `npm run build`。计算、解析和排程规则变化需提供有意义的回归测试；纯布局变化请附桌面/手机实际截图与操作验证。
5. 新增数据库字段时更新 `db/schema.ts` 并新增迁移；不要改写已在线上运行的历史迁移。先在本地数据库验证。

## PR 中说明

- 解决什么问题、用户触发方式、修改后的行为。
- 如何验证，以及尚未验证的范围。不要把自动化测试等同于游戏内独立实测。
- 计算公式、取整、价格来源或数据版本的变化。
- 是否增加迁移、修改缓存或影响旧分享数据，是否需要特殊发布顺序。

变更由维护者审阅后合并。

## 数据与部署边界

- 不提交 `.env*`、`.dev.vars*`、访问令牌、私钥、浏览器资料、运行时数据库或用户原始扫描/合同记录。
- 需要复现用户问题时，最小化并匿名化样例。分享链接持有者可以读取对应数据，不应把真实作战情报放进公开 issue 或测试。
- 提交数据更新时保留 CCP 数据来源和版本，并提供生成步骤；不要从第三方网站复制实现代码或受限资产。
- GitHub Actions 使用本地数据库验证迁移。需要部署时，请配置自己的 Worker 和 D1 数据库。
- 本仓库尚未选择开源许可。获得协作访问并不意味着游戏资产或代码可以任意再授权。

## English

Create a feature branch from `main`, keep PRs focused, and run `npm run check` plus `npm run build`. Describe behavior, validation, migrations and release risks. Preserve bilingual UI, mobile layouts and existing saved/share data. Add meaningful regression tests for calculation and parsing changes; provide actual UI verification for layout changes. Maintainer review precedes merge. CI uses a local database. Never commit secrets or live user data.
