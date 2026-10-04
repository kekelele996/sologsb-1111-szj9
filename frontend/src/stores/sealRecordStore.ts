import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { evaluateSeal } from '../utils/sealing';
import type { SealMethod, SealRecord, SealSegment, SealVerdict } from '../types/sealing';
import type { SealRequirement } from '../types/sealing';

export interface SealRecordInput {
  holeId: string;
  method: SealMethod;
  segments: Array<{ fromDepth: number; toDepth: number; cementTons: number }>;
  sealedAt: string;
  shift: string;
  operator: string;
  remark?: string;
}

export class CrewSubmitError extends Error {}

interface SealRecordState {
  records: SealRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  byHole: (holeId: string) => SealRecord[];
  /**
   * 班组侧提交：只写 sealRecords 表，编录室那份（sealRequirements）一律不动。
   * 按矿化段对账：保护矿化段没被封孔段盖住则判「退回补封」，编录室要求原样保留。
   * forceFail 模拟提交失败：本侧抛错、表单留存按本侧重试，不触碰编录室数据。
   */
  submitRecord: (input: SealRecordInput, requirement: SealRequirement | undefined, forceFail?: boolean) => Promise<{ record: SealRecord; verdict: SealVerdict }>;
  /** 封孔要求改动后，对原合格孔按新版本重新确认；不合格仍退回补封 */
  reconfirm: (holeId: string, requirement: SealRequirement) => Promise<SealRecord | undefined>;
}

function normalizeSegments(input: SealRecordInput): SealSegment[] {
  return input.segments.map((seg) => ({
    id: uid('seg'),
    fromDepth: Number(seg.fromDepth) || 0,
    toDepth: Number(seg.toDepth) || 0,
    cementTons: Number(seg.cementTons) || 0,
  }));
}

/** 钻探班组侧：封孔方式、封孔起止深度与水泥用量（编录室封孔要求不在本侧写入） */
export const useSealRecordStore = create<SealRecordState>()((set, get) => ({
  records: [],
  hydrated: false,

  hydrate: async () => {
    const records = await db.sealRecords.orderBy('sealedAt').toArray();
    set({ records, hydrated: true });
  },

  byHole: (holeId) => get().records.filter((r) => r.holeId === holeId),

  submitRecord: async (input, requirement, forceFail = false) => {
    const segments = normalizeSegments(input);
    const now = new Date().toISOString();

    // 先组装但不落库，失败（含模拟失败）时编录室与本侧表都不动；表单留在弹窗里按本侧重试
    const draft: SealRecord = {
      id: uid('sealrec'),
      holeId: input.holeId,
      method: input.method,
      segments,
      verdict: 'pending',
      matchedVersion: requirement?.version ?? 0,
      sealedAt: input.sealedAt,
      shift: input.shift,
      operator: input.operator.trim(),
      remark: input.remark?.trim() || undefined,
    };

    if (forceFail) {
      throw new CrewSubmitError('班组封孔记录提交失败（模拟）：本侧数据未写入，可直接按本侧重试；编录室封孔要求未改动。');
    }

    // 按矿化段对账（只读编录室要求，不写）
    const result = requirement
      ? evaluateSeal(requirement, [...get().records.filter((r) => r.holeId === input.holeId), draft])
      : { qualified: true, uncovered: [] };
    const record: SealRecord = {
      ...draft,
      verdict: requirement ? (result.qualified ? 'qualified' : 'rejected') : 'pending',
      checkedAt: requirement ? now : undefined,
      ...(requirement ? { uncoveredAtCheck: result.uncovered } : {}),
    };

    await db.sealRecords.put(record);
    set({ records: [...get().records, record] });
    return { record, verdict: record.verdict };
  },

  reconfirm: async (holeId, requirement) => {
    const active = get()
      .records.filter((r) => r.holeId === holeId && !r.legacy)
      .sort((a, b) => (a.checkedAt || a.sealedAt).localeCompare(b.checkedAt || b.sealedAt));
    const latest = active.at(-1);
    if (!latest) return undefined;

    const { qualified, uncovered } = evaluateSeal(requirement, active);
    const next: SealRecord = {
      ...latest,
      verdict: qualified ? 'qualified' : 'rejected',
      matchedVersion: requirement.version,
      checkedAt: new Date().toISOString(),
      uncoveredAtCheck: uncovered,
    };
    await db.sealRecords.put(next);
    set({ records: get().records.map((r) => (r.id === next.id ? next : r)) });
    return next;
  },
}));
