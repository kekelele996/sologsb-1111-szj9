/**
 * 封孔分账模型：
 * - 编录室侧（SealRequirement，表 sealRequirements）：终孔深度、要保护的矿化段、封孔要求（封孔类型 / 要求封闭段）
 * - 班组侧（SealRecord，表 sealRecords）：封孔方式、封孔起止深度（可多段）、水泥用量
 * 两份数据各自写入各自的表，互不同步对方字段；对账按矿化段派生，不落表。
 */

/** 封孔方式（班组填） */
export type SealMethod = '全孔水泥封闭' | '分段水泥封闭' | '水泥砂浆封闭' | '水泥桥塞封闭';

/** 封孔类型（编录室提封孔要求时选） */
export type SealKind = '整孔封闭' | '矿化段封闭' | '分段封闭';

/** 班组判定状态（提交/重新确认时盖章，落表） */
export type SealVerdict = 'qualified' | 'rejected' | 'pending';

/** 深度段（矿化段 / 要求封闭段 / 实际封孔段共用） */
export interface DepthSpan {
  from: number;
  to: number;
}

/** 编录室侧：封孔要求（含终孔深度、要保护的矿化段） */
export interface SealRequirement {
  id: string;
  /** 所属钻孔 */
  holeId: string;
  /** 终孔深度（m），编录室这份自己持有；终孔后才能提封孔要求 */
  finalDepth: number;
  /** 要保护的矿化段（对账基准） */
  mineralRanges: DepthSpan[];
  /** 封孔类型 */
  sealKind: SealKind;
  /** 要求封闭段（整孔封闭回填时为 [0, finalDepth]） */
  requiredRanges: DepthSpan[];
  /** 封孔要求版本：要求内容改动后 +1，先前的合格判定随之失效需重新确认 */
  version: number;
  /** 要求来源 */
  source: 'logging' | 'legacy-backfill';
  /** 编录人 */
  logger: string;
  /** 最近一次内容签名（mineralRanges + requiredRanges + finalDepth），用于判断改动是否要升版 */
  signature: string;
  createdAt: string;
  updatedAt: string;
  remark?: string;
}

/** 班组侧：封孔段（一条封孔记录可含多段） */
export interface SealSegment {
  id: string;
  /** 起深度（m） */
  fromDepth: number;
  /** 止深度（m） */
  toDepth: number;
  /** 本段水泥用量（t） */
  cementTons: number;
}

/** 班组侧：封孔记录（封孔方式 / 封孔起止深度 / 水泥用量） */
export interface SealRecord {
  id: string;
  /** 所属钻孔 */
  holeId: string;
  /** 封孔方式 */
  method: SealMethod;
  /** 实际封孔段 */
  segments: SealSegment[];
  /** 判定状态：合格 / 退回补封 / 待判定 */
  verdict: SealVerdict;
  /** 判定时所依据的封孔要求版本；落后于当前要求版本即需重新确认 */
  matchedVersion: number;
  /** 退回时未盖住的保护段（快照，退回留痕） */
  uncoveredAtCheck?: DepthSpan[];
  checkedAt?: string;
  sealedAt: string;
  /** 封孔班组 */
  shift: string;
  operator: string;
  /** 旧留证：v3 升级前对不上的旧封孔记录，只读展示，不参与工作台合格率 */
  legacy?: boolean;
  remark?: string;
}

/** 对账单孔判定 */
export type ReconcileStatus =
  | 'no-requirement' // 无封孔要求（未终孔）
  | 'no-seal' // 待封孔（编录室已提要求，班组未报）
  | 'rejected' // 已退回补封（矿化段未被封孔段盖住）
  | 'stale' // 待重新确认（封孔要求改动后，原合格判定失效）
  | 'qualified'; // 合格

/** 孔级对账结果（派生） */
export interface SealReconcile {
  holeId: string;
  requirement?: SealRequirement;
  /** 最新一条非旧留证的班组记录（对账以它为准） */
  latest?: SealRecord;
  /** 旧留证记录（只读） */
  legacy: SealRecord[];
  status: ReconcileStatus;
  /** 合并后的实际封孔覆盖段（含旧留证，用于判定老孔整孔封闭是否一致） */
  covered: DepthSpan[];
  /** 当前未盖住的保护段（矿化段口径） */
  uncovered: DepthSpan[];
  /** 老孔旧留证与回填的整孔封闭要求一致：只读且判合格，不计改版重新确认 */
  legacyMatched: boolean;
}

export const SEAL_METHODS: SealMethod[] = ['全孔水泥封闭', '分段水泥封闭', '水泥砂浆封闭', '水泥桥塞封闭'];
export const SEAL_KINDS: SealKind[] = ['整孔封闭', '矿化段封闭', '分段封闭'];

export const RECONCILE_STATUS_META: Record<ReconcileStatus, { label: string; color: string }> = {
  'no-requirement': { label: '未终孔 · 无要求', color: 'default' },
  'no-seal': { label: '待封孔', color: 'orange' },
  rejected: { label: '已退回补封', color: 'red' },
  stale: { label: '待重新确认', color: 'gold' },
  qualified: { label: '合格', color: 'green' },
};

/** 水泥用量合计 */
export function totalCement(record: SealRecord | undefined): number {
  if (!record) return 0;
  return Number(record.segments.reduce((sum, seg) => sum + (Number(seg.cementTons) || 0), 0).toFixed(2));
}
