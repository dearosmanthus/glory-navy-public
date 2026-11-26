# Glory Navy · EVE Online 工具站

面向国际服 Tranquility 的中英双语工具站。

## 现有功能

| 模块 | 入口 | 内容 |
| --- | --- | --- |
| LP 查询 / LP Store | `/` | 按势力、军团查询兑换；LP、AK、零 LP 报价；蓝图成品减材料估值 |
| 工业制造 / Industry | `/#industry` | 制造、反应、生产链、设施与改装件、角色与蓝图约束排产、采购清单 |
| 合同计价 / Appraisal | `/#contract` | 中英文剪贴板解析，买单/卖单/中间价，折价，可选化矿/装备回收，分享链接 |
| 独立化矿 / Reprocessing | `/#reprocessing` | 普矿、月矿、冰矿、装备；技能、建筑、植入体与回收率 |
| 战场扫描 / Battle Scan | `/#dscan` | D-Scan 舰船统计、成员军团/联盟汇总、手动补充、分享链接 |

默认市场为吉他。买单指所选空间站最高收购价，卖单指最低出售报价；估价不保证实际成交量。当前使用公开 ESI，无角色登录或 EVE SSO。

## 本地运行

安装 **Node.js 24** 和 Git。从本仓库页面的 Code 菜单复制克隆地址，克隆后进入项目目录。以下命令在项目根目录运行；Windows、macOS、Linux 使用相同 npm 命令。

```sh
npm ci
npm run build
npm run db:local
npm run dev
```

打开终端输出的本地地址。首次构建会生成 Worker 配置，`db:local` 只给本机数据库应用 `drizzle/` 中的迁移；它不连接线上数据库。正常开发不需要 Cloudflare 登录、API 密钥、Python 或原始 SDE 压缩包。

要运行构建后的 Worker：`npm start`。增加迁移或修改 Vite 配置后，重新构建并运行 `npm run db:local`。数据库缺少迁移时，分享链接及扫描成员查询可能失败，即使 `/healthz` 正常。

## 检查与协作

```sh
npm run check
npm run build
```

`check` 包含 TypeScript、业务代码 lint 和现有自动测试。GitHub PR 自动执行这些检查、构建及本地数据库迁移。全库 `npm run lint` 仍保留原命令，通用 UI 模板存在已知错误，详见交接说明；CI 不宣称其已通过。

开发者从 `main` 建立功能分支并通过 Pull Request 提交。参见[贡献流程](CONTRIBUTING.md)、[项目交接](docs/handoff.md)和[本地数据库与部署](docs/deployment.md)。

## 目录

- `app/`：五个模块、语言与导航，以及 Worker API 路由。
- `lib/`：市场缓存、剪贴板解析、生产图与排产等共享逻辑。
- `public/`：已生成的精简静态游戏目录，按需加载。
- `db/schema.ts`、`drizzle/`：D1 数据结构与版本迁移。
- `tests/`：生产排程、扫描解析与剪贴板行定位测试。
- `scripts/`、`data/`：数据生成工具与现有来源记录。
- `docs/`：部署、功能约束、已知问题及交接说明。

## English quick start

Glory Navy is a bilingual EVE Online utility website for Tranquility. It uses React, TypeScript, vinext/Vite and Cloudflare Workers with D1. Install Node 24, run `npm ci`, `npm run build`, `npm run db:local`, then `npm run dev`. Run `npm run check` and `npm run build` before submitting a PR. No Cloudflare account or game login is required for local development. GitHub Actions runs checks, builds the project and initializes a local database.

The repository includes source, generated catalogs and migrations. It excludes production snapshots, credentials, dependencies and build output. Some SDE regeneration/provenance workflows remain incomplete; see [handoff notes](docs/handoff.md). No open-source license has been selected for the project; third-party code and CCP data retain their respective rights. See [third-party notices](THIRD_PARTY_NOTICES.md).
