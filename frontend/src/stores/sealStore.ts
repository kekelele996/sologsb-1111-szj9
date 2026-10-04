import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { estimateCementKg, reconcileSeal } from '../utils/seal';
import type { DrillHole } from '../types/drill-hole';
import type { ProtectedSection, SealMethod, SealRecord, SealReconcile, SealRequirement } from '../types/seal';

export interface RequirementInput {
  holeId: string;
  protectedSections: ProtectedSection[];
  requirement: string;
  setBy: string;
}

export interface RecordInput {
  holeId: string;
  method: SealMethod;
  fromDepth: number;
  toDepth: number;
  cementKg: number;
  team: string;
  sealedAt: string;
  recorder: string;
  remark?: string;
}

interface SealState {
  requirements: SealRequirement[];
  records: SealRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** 新建或更新封孔要求（编录室那份）：更新时版本号 +1，先前合格判定作废 */
  upsertRequirement: (input: RequirementInput) => Promise<SealRequirement>;
  /** 提交编录室这份（失败仅改本方状态，不影响班组那份） */
  submitRequirement: (id: string) => Promise<void>;
  /** 重新确认：把确认版本追平当前要求版本 */
  confirmRequirement: (id: string) => Promise<void>;
  /** 新建或更新封孔记录（班组那份）：更新后本方提交状态回到未提交 */
  upsertRecord: (input: RecordInput) => Promise<SealRecord>;
  /** 提交班组这份（失败仅本方重试，编录室那份不动） */
  submitRecord: (id: string) => Promise<void>;
  /** 删除班组记录（只读旧记录不可删） */
  removeRecord: (id: string) => Promise<void>;
  requirementOf: (holeId: string) => SealRequirement | undefined;
  recordOf: (holeId: string) => SealRecord | undefined;
  /** 按孔对账 */
  reconcileOf: (hole: DrillHole) => SealReconcile;
}

/** 模拟提交到服务端：纯前端无后端，随机成功/失败以演示「失败后按本侧重试」 */
async function fakeSubmit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (Math.random() < 0.3) {
    throw new Error('网络波动，提交失败，请重试');
  }
}

export const useSealStore = create<SealState>()((set, get) => ({
  requirements: [],
  records: [],
  hydrated: false,

  hydrate: async () => {
    const [requirements, records] = await Promise.all([
      db.sealRequirements.orderBy('setAt').toArray(),
      db.sealRecords.orderBy('sealedAt').toArray(),
    ]);
    set({ requirements, records, hydrated: true });
  },

  upsertRequirement: async (input) => {
    const current = get().requirements.find((r) => r.holeId === input.holeId);
    const now = new Date().toISOString();
    const next: SealRequirement = current
      ? {
          ...current,
          protectedSections: input.protectedSections,
          requirement: input.requirement.trim(),
          setBy: input.setBy.trim(),
          setAt: now,
          version: current.version + 1,
          // confirmedVersion 保留旧值 → 落后于 version，触发「待重新确认」
          submitStatus: '未提交',
          submittedAt: undefined,
        }
      : {
          id: uid('seal-req'),
          holeId: input.holeId,
          protectedSections: input.protectedSections,
          requirement: input.requirement.trim(),
          setBy: input.setBy.trim(),
          setAt: now,
          version: 1,
          // 新建要求即视为首次确认，避免一上来就「待重新确认」
          confirmedVersion: 1,
          submitStatus: '未提交',
        };
    await db.sealRequirements.put(next);
    set({ requirements: [...get().requirements.filter((r) => r.holeId !== input.holeId), next] });
    return next;
  },

  submitRequirement: async (id) => {
    const current = get().requirements.find((r) => r.id === id);
    if (!current) return;
    try {
      await fakeSubmit();
      const next: SealRequirement = { ...current, submitStatus: '已提交', submittedAt: new Date().toISOString() };
      await db.sealRequirements.put(next);
      set({ requirements: get().requirements.map((r) => (r.id === id ? next : r)) });
    } catch {
      const next: SealRequirement = { ...current, submitStatus: '提交失败' };
      await db.sealRequirements.put(next);
      set({ requirements: get().requirements.map((r) => (r.id === id ? next : r)) });
      throw new Error('编录室封孔要求提交失败，请重试');
    }
  },

  confirmRequirement: async (id) => {
    const current = get().requirements.find((r) => r.id === id);
    if (!current) return;
    const next: SealRequirement = { ...current, confirmedVersion: current.version };
    await db.sealRequirements.put(next);
    set({ requirements: get().requirements.map((r) => (r.id === id ? next : r)) });
  },

  upsertRecord: async (input) => {
    const current = get().records.find((r) => r.holeId === input.holeId);
    if (current?.legacy) {
      throw new Error('升级回填的旧封孔记录只读，不可编辑');
    }
    const now = new Date().toISOString();
    const next: SealRecord = current
      ? {
          ...current,
          method: input.method,
          fromDepth: Number(input.fromDepth) || 0,
          toDepth: Number(input.toDepth) || 0,
          cementKg: Number(input.cementKg) || estimateCementKg(input.method, input.fromDepth, input.toDepth),
          team: input.team.trim(),
          sealedAt: input.sealedAt,
          recorder: input.recorder.trim(),
          remark: input.remark?.trim() || undefined,
          // 班组记录改动后本方提交状态回到未提交，需重新提交
          submitStatus: '未提交',
          submittedAt: undefined,
        }
      : {
          id: uid('seal-rec'),
          holeId: input.holeId,
          method: input.method,
          fromDepth: Number(input.fromDepth) || 0,
          toDepth: Number(input.toDepth) || 0,
          cementKg: Number(input.cementKg) || estimateCementKg(input.method, input.fromDepth, input.toDepth),
          team: input.team.trim(),
          sealedAt: input.sealedAt,
          recorder: input.recorder.trim(),
          remark: input.remark?.trim() || undefined,
          submitStatus: '未提交',
        };
    await db.sealRecords.put(next);
    set({ records: [...get().records.filter((r) => r.holeId !== input.holeId), next] });
    return next;
  },

  submitRecord: async (id) => {
    const current = get().records.find((r) => r.id === id);
    if (!current || current.legacy) return;
    try {
      await fakeSubmit();
      const next: SealRecord = { ...current, submitStatus: '已提交', submittedAt: new Date().toISOString() };
      await db.sealRecords.put(next);
      set({ records: get().records.map((r) => (r.id === id ? next : r)) });
    } catch {
      const next: SealRecord = { ...current, submitStatus: '提交失败' };
      await db.sealRecords.put(next);
      set({ records: get().records.map((r) => (r.id === id ? next : r)) });
      throw new Error('班组封孔记录提交失败，请重试');
    }
  },

  removeRecord: async (id) => {
    const current = get().records.find((r) => r.id === id);
    if (!current || current.legacy) return;
    await db.sealRecords.delete(id);
    set({ records: get().records.filter((r) => r.id !== id) });
  },

  requirementOf: (holeId) => get().requirements.find((r) => r.holeId === holeId),
  recordOf: (holeId) => get().records.find((r) => r.holeId === holeId),

  reconcileOf: (hole) =>
    reconcileSeal(hole, get().requirements.find((r) => r.holeId === hole.id), get().records.find((r) => r.holeId === hole.id)),
}));
