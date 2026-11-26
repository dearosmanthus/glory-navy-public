# 本地数据库与部署

GitHub Actions 会安装锁定依赖、检查类型与代码、运行测试、构建 Worker，并在本地 D1 数据库应用迁移。

## 本地 Worker 和 D1

安装 Node.js 24，在项目根目录执行。

```sh
npm ci
npm run build
npm run db:local
npm start
```

开发时可用 `npm run dev` 替换最后一条。迁移文件位于 `drizzle/`，本地数据库位于 `.wrangler/state/`。修改迁移或 Vite 配置后，重新构建并应用本地迁移。

## 部署自己的实例

在 Cloudflare 创建自己的 Worker 和 D1 数据库，为 Worker 绑定名为 `DB` 的数据库。配置静态资源目录为 `dist/client`、Worker 入口为 `dist/server/index.js`，并启用 `nodejs_compat`。部署前在自己的 D1 实例应用 `drizzle/` 中的迁移。部署凭据通过环境变量或仓库 Secret 管理，数据库备份和分享数据应保存在访问受控的位置。

`/healthz` 可检查 Worker 是否响应。要核对站点、版本和 D1，应先运行 `node scripts/write-release.mjs <完整提交SHA>` 给构建产物标记版本。部署后执行 `node scripts/smoke-production.mjs <完整提交SHA> <站点URL>`。

参考 [Cloudflare Worker 持续集成文档](https://developers.cloudflare.com/workers/ci-cd/)。
