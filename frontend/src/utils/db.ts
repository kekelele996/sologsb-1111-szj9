import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { SealRecord, SealRequirement } from '../types/sealing';
import { uid } from './id';
import { parseLegacySeal, requirementSignature } from './sealing';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbdrillcore-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class DrillCoreDB extends Dexie {
  holes!: Table<DrillHole, string>;
  runs!: Table<DrillRun, string>;
  boxes!: Table<CoreBox, string>;
  lithos!: Table<LithoLog, string>;
  sealRequirements!: Table<SealRequirement, string>;
  sealRecords!: Table<SealRecord, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      holes: 'id, holeNo, rigNo, shift, startDate',
      runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
      boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
      lithos: 'id, holeId, fromDepth, toDepth, lithology',
      meta: 'key',
    });

    // v2：岩性表增加 (holeId+fromDepth) 复合索引，按深度区间查询更快；并回填历史 rqd 缺省值。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lithos')
          .toCollection()
          .modify((row: LithoLog) => {
            if (typeof row.rqd !== 'number') {
              row.rqd = 0;
            }
          });
      });

    // v3：封孔分账——新增编录室「封孔要求」与班组「封孔记录」两张表，各管各的。
    // 老孔没有封孔要求：对终孔孔按终孔深度回填为「整孔封闭」；
    // 旧终孔报告里的封孔描述落成只读旧留证（与回填要求对不上也只读，不进入补封流程）。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        sealRequirements: 'id, holeId, version',
        sealRecords: 'id, holeId, verdict, sealedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const holes = await tx.table<DrillHole, string>('holes').toArray();
        const now = new Date().toISOString();
        const backfilled: SealRequirement[] = [];
        const legacy: SealRecord[] = [];

        holes
          .filter((hole) => hole.finalDepth > 0)
          .forEach((hole) => {
            // 老孔没有矿化段信息，按终孔深度整孔封闭回填
            const requiredRanges = [{ from: 0, to: Number(hole.finalDepth.toFixed(2)) }];
            backfilled.push({
              id: uid('sealreq'),
              holeId: hole.id,
              finalDepth: hole.finalDepth,
              mineralRanges: [],
              sealKind: '整孔封闭',
              requiredRanges,
              version: 1,
              source: 'legacy-backfill',
              logger: '系统回填',
              signature: requirementSignature(hole.finalDepth, [], requiredRanges),
              createdAt: now,
              updatedAt: now,
              remark: '老孔无封孔要求，升级时按终孔深度回填为整孔封闭',
            });

            // 旧终孔报告里写过一句封孔的，落成旧留证；与回填要求对不上也只读
            const parsed = parseLegacySeal(hole.remark);
            if (parsed) {
              const mismatch = parsed.ranges.some((r) => r.from > 0.0001 || Math.abs(r.to - hole.finalDepth) > 0.01);
              legacy.push({
                id: uid('sealrec'),
                holeId: hole.id,
                method: '全孔水泥封闭',
                segments: parsed.ranges.map((r, i) => ({
                  id: `legacy-seg-${i}`,
                  fromDepth: r.from,
                  toDepth: r.to,
                  cementTons: parsed.cementTons ?? 0,
                })),
                verdict: 'qualified',
                matchedVersion: 0,
                checkedAt: hole.endDate ?? now,
                sealedAt: hole.endDate ?? now,
                shift: hole.shift,
                operator: '旧终孔报告',
                legacy: true,
                remark: mismatch
                  ? `旧封孔记录与整孔封闭回填要求对不上（${parsed.ranges.map((r) => `${r.from}~${r.to}m`).join('、')}），只读留证`
                  : '升级前的旧封孔记录，只读留证',
              });
            }
          });

        if (backfilled.length) await tx.table('sealRequirements').bulkPut(backfilled);
        if (legacy.length) await tx.table('sealRecords').bulkPut(legacy);
      });
  }
}

export const db = new DrillCoreDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
