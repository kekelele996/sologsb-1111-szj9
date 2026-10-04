import type { DrillHole } from '../types/drill-hole';
import type { LithoLog } from '../types/litho-log';
import type { ProtectedSection, SealMethod, SealRecord, SealReconcile, SealRequirement } from '../types/seal';
import { mergeRanges } from './recovery';

/** 封孔方式 → 水泥用量估算系数（kg/m），仅升级回填旧封孔记录时用 */
const CEMENT_FACTOR: Record<SealMethod, number> = {
  水泥浆封孔: 15,
  黏土封孔: 10,
  水泥卷封孔: 8,
  整孔封闭: 15,
};

/** 估算水泥用量（kg）：按封孔段长度 × 方式系数 */
export function estimateCementKg(method: SealMethod, fromDepth: number, toDepth: number): number {
  const length = Math.max(0, toDepth - fromDepth);
  return Math.round(length * CEMENT_FACTOR[method]);
}

/** 由矿化岩性段派生需保护矿化段（矿化 != 无），相邻段合并并带回矿化类型 */
export function suggestedProtectedSections(lithos: LithoLog[], holeId: string): ProtectedSection[] {
  const mineralized = lithos
    .filter((log) => log.holeId === holeId && log.mineralization !== '无' && log.toDepth > log.fromDepth)
    .sort((a, b) => a.fromDepth - b.fromDepth);
  const merged = mergeRanges(mineralized.map((log) => ({ from: log.fromDepth, to: log.toDepth })));
  return merged.map((range, index) => {
    const notes = mineralized
      .filter((log) => log.fromDepth < range.to && log.toDepth > range.from)
      .map((log) => log.mineralization);
    return {
      id: `sec-${holeId}-${index}-${range.from}`,
      fromDepth: range.from,
      toDepth: range.to,
      note: Array.from(new Set(notes)).join('、') || undefined,
    };
  });
}

const EPS = 0.0001;

/** 封孔段是否盖住某个需保护矿化段（封孔段包含矿化段） */
export function sectionCovered(section: ProtectedSection, record: SealRecord): boolean {
  return record.fromDepth <= section.fromDepth + EPS && record.toDepth >= section.toDepth - EPS;
}

/**
 * 对账：按矿化段核对封孔段是否盖住需保护段。
 * - 无要求 → 无要求；有要求无记录 → 未封孔
 * - 有矿化段未盖住 → 退回补封（优先于重新确认）
 * - 全部盖住但确认版本落后于要求版本 → 待重新确认
 * - 其余 → 合格
 */
export function reconcileSeal(
  hole: DrillHole,
  requirement: SealRequirement | undefined,
  record: SealRecord | undefined,
): SealReconcile {
  const base: SealReconcile = { holeId: hole.id, requirement, record, uncovered: [], status: '无要求', statusText: '无封孔要求' };
  if (!requirement || requirement.protectedSections.length === 0) {
    return base;
  }
  if (!record) {
    return { ...base, status: '未封孔', statusText: '未封孔' };
  }
  const uncovered = requirement.protectedSections.filter((section) => !sectionCovered(section, record));
  if (uncovered.length > 0) {
    return { ...base, uncovered, status: '退回补封', statusText: '退回补封' };
  }
  if (requirement.confirmedVersion !== undefined && requirement.confirmedVersion < requirement.version) {
    return { ...base, status: '待重新确认', statusText: '待重新确认' };
  }
  return { ...base, status: '合格', statusText: '合格' };
}

/** 封孔合格率：合格孔数 / 有封孔要求的孔数（无要求的老孔不计入分母） */
export function sealQualifiedRate(reconciles: SealReconcile[]): { rate: number; qualified: number; total: number } {
  const withReq = reconciles.filter((item) => item.status !== '无要求');
  const qualified = withReq.filter((item) => item.status === '合格').length;
  const rate = withReq.length > 0 ? Number(((qualified / withReq.length) * 100).toFixed(1)) : 0;
  return { rate, qualified, total: withReq.length };
}
