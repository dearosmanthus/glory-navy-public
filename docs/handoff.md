# 项目交接 / Maintainer handoff

## 当前架构

React 19 + TypeScript；vinext（beta）提供 Next 风格路由，Vite 负责构建，Cloudflare Workers 运行服务端，D1 保存分享快照与限流计数。准确依赖版本以 `package-lock.json` 为准，使用 `npm ci` 安装。

浏览器按需加载工具与 `public/*.json`。角色排产参数、界面语言与估价设置保存在用户浏览器；不存在 EVE SSO、账号系统或读取游戏客户端的能力。

| 数据流 | 实现位置 | 说明 |
| --- | --- | --- |
| ESI / Fuzzwork 公共查询 | `app/api/`、`lib/edge-json.ts` | Worker 代理、规范化缓存键、同一实例中请求合并；不是全局互斥锁 |
| 市场定价 | `lib/eve-market.ts` | 默认吉他空间站；最高买单、最低卖单，不是保证可成交的深度报价 |
| 工业图与排程 | `lib/industry-planning.ts` | 本地计算；角色/蓝图/批次资源与依赖约束 |
| 合同分享 | `app/api/appraisals/` | D1 快照，90 天有效；持有链接者可访问 |
| 扫描与成员查询 | `lib/battle-scan.ts`、`app/api/scan-characters/` | 舰船解析用静态目录；成员所属军团/联盟用公共 ESI |
| 扫描分享 | `app/api/scans/` | D1 快照，30 天有效；持有链接者可访问 |

分享创建/读取及成员查询限流需要 D1；普通 LP、市场和状态代理不需要数据库。`/healthz` 只验证 HTTP 存活，不能替代数据库和上游连通性检查。

## 已有功能约束与验证记录

- [生产链与角色排程](industry-scheduling.md)：启发式排程、批次取整、资源约束及不包含的游戏条件。
- [战场扫描](battle-scan.md)：剪贴板格式、分享数据、输入限制、数据来源。
- [交互与响应式流程](workflow.md)：当前操作流程、移动端规则及最近一次验证范围。

当前测试主要覆盖工业排程、扫描解析、剪贴板行定位。合同/化矿 UI 和全部 API 没有完整的自动化端到端测试套件。最新布局调整做过构建与 HTTP 验证，尚未进行该版本的浏览器交互/截图回归；接手后优先用真实中英文合同、D-Scan 与手机浏览器验证。

`npm run lint:app` 检查 `app lib tests scripts`，是当前 CI 门槛。全库 `npm run lint` 在交接时有 19 个既有错误，位于通用 `components/ui` 和 `hooks/use-mobile.ts`；不要将此描述成“全库 lint 已通过”。这些模板问题可独立修复，修复后再扩大 CI 范围。

工业排程测试验证模型一致性，不代表已与同 SDE 版本下的游戏实测全面校准。生产链成本与设施、技能、材料取整改动应附独立算例，尤其关注单次泰坦总装、反应与制造的独立槽位。

## 数据来源与重建

仓库包含六个生成后的目录文件：`contract-data.json`、`industry-data.json`、`lp-blueprints.json`、`lp-type-names.json`、`reprocessing-data.json`、`scan-data.json`。普通 clone/build 直接使用它们，不下载原始 SDE。

现有数据围绕 CCP JSONL SDE build **3494416** 构建。扫描数据有输入/输出 SHA-256 清单：`data/scan-data-provenance.json`。不能据此声称其他全部目录也具有相同完整性证明。

- 工业：`python scripts/generate-industry-data.py`；当前脚本读取项目上级目录的 `eve-sde-latest-jsonl.zip`。
- 化矿：`node scripts/generate-reprocessing-data.cjs`；读取 `.sde-tmp/` 中 JSONL。
- 扫描：`node scripts/generate-scan-data.mjs`；默认读取 `.sde-tmp/`，可通过首个参数指定源目录，并更新来源哈希。
- **未完成的重建链路**：合同目录、LP 蓝图与中英文名目录的生成脚本尚未纳入仓库；工业/化矿缺少完整输入输出哈希记录。请保留现有生成结果，补齐流程后再整批升级数据。

数据升级应固定 SDE 版本、保存来源/哈希、生成结果 diff，并重跑计算测试；不要在不同目录中悄悄混用版本。原始压缩包与展开目录不入库。

## 部署

本地开发使用项目目录内的 D1 状态。自建站点请配置自己的 Worker 和 D1 数据库，见[本地数据库与部署](deployment.md)。

## 推荐接手顺序

1. 本地启动并验证五个模块、双语、移动端与分享加载。
2. 使用小 PR 修复具体反馈，并附复现输入和验证结果。
3. 补全合同/化矿和 API 自动回归；补齐 SDE 生成及来源记录。
4. 独立处理全库 lint 基线；再考虑依赖升级与 EVE SSO。

