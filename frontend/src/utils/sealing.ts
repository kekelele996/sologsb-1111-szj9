import type { DepthSpan, ReconcileStatus, SealReconcile, SealRecord, SealRequirement } from '../types/sealing';
import type { LithoLog } from '../types/litho-log';
import { mergeRanges } from './recovery';

/** 矿化段：岩性编录中 mineralization 非「无」的深度区间（编录室对账基准） */
export function extractMineralRanges(lithos: LithoLog[]): DepthSpan[] {
  return mergeRanges(
    lithos
      .filter((log) => log.mineralization && log.mineralization !== '无')
      .map((log) => ({ from: log.fromDepth, to: log.toDepth })),
  );
}

/** 按封孔类型生成要求封闭段：整孔封闭 = [0, 终孔深度]；矿化段封闭 = 矿化段；分段封闭沿用手工段 */
export function buildRequiredRanges(kind: SealRequirement['sealKind'], finalDepth: number, mineralRanges: DepthSpan[], custom: DepthSpan[]): DepthSpan[] {
  if (kind === '整孔封闭') return finalDepth > 0 ? [{ from: 0, to: finalDepth }] : [];
  if (kind === '矿化段封闭') return mergeRanges(mineralRanges);
  return mergeRanges(custom);
}

const round = (n: number) => Number(n.toFixed(2));

/** 封孔要求内容签名：终孔深度 / 矿化段 / 要求封闭段任一改动即不同（决定要不要升版） */
export function requirementSignature(finalDepth: number, mineralRanges: DepthSpan[], requiredRanges: DepthSpan[]): string {
  const fmt = (ranges: DepthSpan[]) =>
    mergeRanges(ranges)
      .map((r) => `${round(r.from)}-${round(r.to)}`)
      .join('|');
  return `d=${round(finalDepth)};m=${fmt(mineralRanges)};r=${fmt(requiredRanges)}`;
}

/** 实际封孔覆盖：合并班组封孔段（默认含旧留证，用于老孔整孔封闭对账；新孔对账时排除） */
export function coveredRanges(records: SealRecord[], includeLegacy = true): DepthSpan[] {
  return mergeRanges(
    records
      .filter((r) => includeLegacy || !r.legacy)
      .flatMap((r) => r.segments)
      .map((s) => ({ from: s.fromDepth, to: s.toDepth })),
  );
}

/** 保护段里没被封孔覆盖段盖住的部分（按矿化段对账；端点相接视为盖住） */
export function uncoveredParts(targets: DepthSpan[], covered: DepthSpan[]): DepthSpan[] {
  const mergedCovered = mergeRanges(covered);
  const gaps: DepthSpan[] = [];
  mergeRanges(targets).forEach((target) => {
    let cursor = target.from;
    mergedCovered.forEach((c) => {
      if (c.to <= cursor || c.from >= target.to) return;
      if (c.from > cursor) gaps.push({ from: round(cursor), to: round(Math.min(c.from, target.to)) });
      cursor = Math.max(cursor, c.to);
    });
    if (cursor < target.to - 0.0001) gaps.push({ from: round(cursor), to: round(target.to) });
  });
  return gaps.filter((g) => g.to - g.from > 0.0001);
}

/**
 * 提交/重新确认时对账：以封孔要求上的矿化段为准，检查封孔段是否盖住全部矿化段。
 * 没有矿化段的孔（如旧回填的整孔封闭）退化为要求封闭段全覆盖判定。
 */
export function evaluateSeal(requirement: SealRequirement, records: SealRecord[]): { qualified: boolean; uncovered: DepthSpan[] } {
  const active = records.filter((r) => !r.legacy);
  const covered = coveredRanges(active);
  const targets = requirement.mineralRanges.length ? requirement.mineralRanges : requirement.requiredRanges;
  const uncovered = uncoveredParts(targets, covered);
  return { qualified: uncovered.length === 0, uncovered };
}

function latestRecord(records: SealRecord[]): SealRecord | undefined {
  return records
    .filter((r) => !r.legacy)
    .sort((a, b) => (a.checkedAt || a.sealedAt).localeCompare(b.checkedAt || b.sealedAt))
    .at(-1);
}

/** 单孔对账（工作台合格率与对账表共用） */
export function reconcileHole(requirement: SealRequirement | undefined, records: SealRecord[]): SealReconcile {
  const legacy = records.filter((r) => r.legacy);
  const active = records.filter((r) => !r.legacy);
  const covered = coveredRanges(active, false);

  if (!requirement) {
    return { holeId: records[0]?.holeId ?? '', legacy, status: 'no-requirement', covered, uncovered: [], legacyMatched: false };
  }

  const latest = latestRecord(active);
  const targets = requirement.mineralRanges.length ? requirement.mineralRanges : requirement.requiredRanges;
  const uncovered = uncoveredParts(targets, covered);

  // 老孔：无新封孔记录，只有只读旧留证。旧记录与回填的整孔封闭要求一致即判合格（只读），
  // 对不上的旧留证退回待封孔状态（但旧记录本身只读，班组需用新记录补封）。
  const legacyMatched =
    !latest &&
    legacy.length > 0 &&
    requirement.source === 'legacy-backfill' &&
    uncoveredParts(requirement.requiredRanges, coveredRanges(legacy, true)).length === 0;

  let status: ReconcileStatus;
  if (!latest) {
    status = legacyMatched ? 'qualified' : 'no-seal';
  } else if (latest.verdict === 'rejected' || uncovered.length > 0) {
    // 已退回补封（最新一条退回），或按当前要求现状已盖不住（例如矿化段被新增）
    status = 'rejected';
  } else if (latest.matchedVersion < requirement.version) {
    // 封孔要求改动后，先前的合格判定失效，需要重新确认
    status = 'stale';
  } else {
    status = 'qualified';
  }

  return { holeId: requirement.holeId, requirement, latest, legacy, status, covered, uncovered, legacyMatched };
}

export interface SealRateSummary {
  /** 已提封孔要求的孔数（合格率分母） */
  requiredCount: number;
  qualified: number;
  rejected: number;
  stale: number;
  waiting: number;
  /** 合格率 % = 合格 / 已提要求（待封孔、退回、待确认均算未合格） */
  rate: number;
  /** 旧留证孔数（只读，不计入合格率） */
  legacyCount: number;
}

/** 工作台封孔合格率：合格 / 已提封孔要求孔数，一并重算 */
export function summarizeSeals(reconciles: SealReconcile[]): SealRateSummary {
  const withRequirement = reconciles.filter((r) => r.requirement);
  const qualified = withRequirement.filter((r) => r.status === 'qualified').length;
  const rejected = withRequirement.filter((r) => r.status === 'rejected').length;
  const stale = withRequirement.filter((r) => r.status === 'stale').length;
  const waiting = withRequirement.filter((r) => r.status === 'no-seal').length;
  return {
    requiredCount: withRequirement.length,
    qualified,
    rejected,
    stale,
    waiting,
    rate: withRequirement.length ? Number(((qualified / withRequirement.length) * 100).toFixed(1)) : 0,
    legacyCount: reconciles.filter((r) => r.legacy.length > 0).length,
  };
}

/** 从旧钻孔备注里解析旧封孔段：如「终孔报告封孔：0~180m，水泥 8.2t」 */
export function parseLegacySeal(remark?: string): { ranges: DepthSpan[]; cementTons?: number } | undefined {
  if (!remark) return undefined;
  const hit = remark.match(/封孔[：: ]*([0-9]+(?:\.\d+)?\s*[m米]?\s*[~～-]\s*[0-9]+(?:\.\d+)?\s*[m米]?)/);
  if (!hit) return undefined;
  const nums = hit[1].match(/[0-9]+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return undefined;
  const cement = remark.match(/水泥[^0-9~～-]*?([0-9]+(?:\.\d+)?)\s*t/);
  return {
    ranges: [{ from: Number(nums[0]), to: Number(nums[1]) }],
    cementTons: cement ? Number(cement[1]) : undefined,
  };
}
