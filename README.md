# 矿区钻孔岩芯编目台（gbdrillcore）

面向地质勘查钻探班组与地质编录员：登记钻孔台帐、回次进尺与采取率、岩芯箱箱位，按深度区间编录岩性描述与样品，并对终孔孔做封孔分账与按矿化段对账。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21811>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（6 条业务路由 + 404） |
| 状态 | Zustand（holeStore / runStore / boxStore / lithoStore / sealRequirementStore / sealRecordStore） |
| 存储 | IndexedDB（Dexie，库名 `gbdrillcore-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21811
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # drill-hole / drill-run / core-box / litho-log
│       ├── stores/            # holeStore / runStore / boxStore / lithoStore
│       ├── components/common/ # DepthRangeInput / RecoveryBadge / BoxGrid / LithoColumn / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useHoleFilter / useDepthCalc
│       ├── pages/             # HoleBoard / HoleList / RunLog / CoreBoxList / LithoEditor / SealReconcile
│       ├── router/index.tsx   # 路由表
│       └── utils/             # recovery.ts / sealing.ts / db.ts / export.ts（+ seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 工作台 | 钻孔进度、设计达成率、未达设计待补勘清单、采取率异常清单（<75% 标红） |
| `/holes` | 钻孔台帐 | 建孔、坐标与孔口标高、设计/终孔深度、测斜数据、回次深度覆盖与岩芯箱数回显 |
| `/runs` | 回次记录 | 起止深度自动算进尺与采取率，低于 75% 立即标红并入异常清单 |
| `/boxes` | 岩芯箱编目 | 格位网格按深度填充、破损格标记、装箱深度连续性与格位容量校验 |
| `/lithology` | 岩性编录 | 按深度区间编录岩性/蚀变/矿化/RQD/样品，区间重叠报冲突并高亮，SVG 岩性柱状图 |
| `/sealing` | 封孔对账 | 编录室管终孔深度/矿化段/封孔要求，班组管封孔方式/起止深度/水泥用量；按矿化段对账，未盖住则退回班组补封、要求保留；要求改版后重新确认并重算合格率 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbdrillcore-db`），表：`holes`、`runs`、`boxes`、`lithos`、`sealRequirements`、`sealRecords`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为岩性表增加 `[holeId+fromDepth]` 复合索引并回填历史 RQD。
- `db.version(3)` 落地封孔分账两张表：编录室 `sealRequirements`（终孔深度、矿化段、封孔要求，带版本号）与班组 `sealRecords`（封孔方式、封孔起止深度、水泥用量），两边只写各自的表。老孔没有封孔要求，升级时对终孔孔按终孔深度回填为「整孔封闭」；旧终孔报告里的封孔描述落成只读旧留证（`legacy`），与回填要求对不上也只读，不进补封流程。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例编目数据（`src/utils/seed.ts`，5 个钻孔 + 回次 + 岩芯箱 + 岩性区间 + 封孔要求/封孔记录）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

## 封孔分账口径

- **两边各管各的**：钻探班组只写封孔方式、封孔起止深度、各段/合计水泥用量；地质编录室只写终孔深度、要保护的矿化段与封孔要求（整孔封闭 / 矿化段封闭 / 分段封闭）。
- **按矿化段对账**：以编录室确认的矿化段为基准，合并班组全部封孔段后逐段检查覆盖（端点相接视为盖住）；该保护的矿化段没被盖住，班组那条判「退回补封」（记录退回原因并留痕），编录室那份原样保留，班组补封后重报。
- **要求改版**：终孔深度 / 矿化段 / 要求封闭段任一改动，封孔要求版本 +1；先前判定合格的孔变为「待重新确认」，不计合格，经重新确认（仍按矿化段对账）后才恢复合格，工作台封孔合格率（合格孔 / 已提要求孔）一并重算。
- **提交失败只在本侧重试**：班组封孔记录提交失败时不写本侧表、更不触碰编录室要求，弹窗内保留全部输入可直接重试（弹窗提供「模拟提交失败」演练开关）。
- **老孔只读**：升级回填的整孔封闭要求与旧留证不一致时，旧记录只读展示；班组如需处理，用新封孔记录补封，不改旧记录。
