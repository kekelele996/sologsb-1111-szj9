import Dexie, { type Table } from 'dexie';
import type { DrillHole } from '../types/drill-hole';
import type { DrillRun } from '../types/drill-run';
import type { CoreBox } from '../types/core-box';
import type { LithoLog } from '../types/litho-log';
import type { SealRecord, SealRequirement } from '../types/seal';
import { estimateCementKg } from './seal';
import { uid } from './id';

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

    // v3：封孔双端（编录室要求 + 班组记录）。老孔没有封孔要求，升级时按终孔深度回填整孔封闭记录；
    // 对不上的旧封孔记录保留为只读历史件，不强制改写。升级前请先导出备份。
    this.version(3)
      .stores({
        holes: 'id, holeNo, rigNo, shift, startDate',
        runs: 'id, runNo, holeId, fromDepth, toDepth, shift',
        boxes: 'id, boxNo, holeId, shelfPos, boxedAt',
        lithos: 'id, holeId, fromDepth, toDepth, [holeId+fromDepth], lithology',
        sealRequirements: 'id, holeId, submitStatus',
        sealRecords: 'id, holeId, method, submitStatus, legacy',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const holes = await tx.table('holes').toArray();
        const existing = await tx.table('sealRecords').toArray();
        const existingHoleIds = new Set(existing.map((row: SealRecord) => row.holeId));
        const records: SealRecord[] = holes
          .filter((hole: DrillHole) => hole.finalDepth > 0 && !existingHoleIds.has(hole.id))
          .map((hole: DrillHole) => ({
            id: uid('seal-rec'),
            holeId: hole.id,
            method: '整孔封闭',
            fromDepth: 0,
            toDepth: hole.finalDepth,
            cementKg: estimateCementKg('整孔封闭', 0, hole.finalDepth),
            team: hole.shift,
            sealedAt: hole.endDate ?? new Date().toISOString(),
            recorder: '系统回填',
            remark: '升级前老孔，按终孔深度回填整孔封闭，只读',
            legacy: true,
            submitStatus: '已提交',
            submittedAt: new Date().toISOString(),
          }));
        if (records.length) {
          await tx.table('sealRecords').bulkPut(records);
        }
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
