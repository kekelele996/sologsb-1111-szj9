/** 封孔方式 */
export type SealMethod = '水泥浆封孔' | '黏土封孔' | '水泥卷封孔' | '整孔封闭';

export const SEAL_METHODS: SealMethod[] = ['水泥浆封孔', '黏土封孔', '水泥卷封孔', '整孔封闭'];

/** 封孔提交状态（班组与编录室两边各自独立提交） */
export type SealSubmitStatus = '未提交' | '已提交' | '提交失败';

/** 需保护的矿化段（编录室封孔要求的核心） */
export interface ProtectedSection {
  id: string;
  /** 起始深度（m） */
  fromDepth: number;
  /** 终止深度（m） */
  toDepth: number;
  /** 矿化类型备注 */
  note?: string;
}

/** 封孔要求 —— 地质编录室那份（终孔深度 / 矿化段 / 封孔要求） */
export interface SealRequirement {
  id: string;
  /** 所属钻孔 */
  holeId: string;
  /** 需保护的矿化段 */
  protectedSections: ProtectedSection[];
  /** 封孔要求说明 */
  requirement: string;
  /** 要求版本号：每次修改 +1，触发先前合格孔重新确认 */
  version: number;
  /** 最近一次判定合格时的版本号（落后于 version 即待重新确认） */
  confirmedVersion?: number;
  /** 制定人 */
  setBy: string;
  /** 制定/更新时间 ISO */
  setAt: string;
  /** 编录室这份的提交状态 */
  submitStatus: SealSubmitStatus;
  /** 提交时间 ISO */
  submittedAt?: string;
}

/** 封孔记录 —— 钻探班组那份（封孔方式 / 起止深度 / 水泥用量） */
export interface SealRecord {
  id: string;
  /** 所属钻孔 */
  holeId: string;
  /** 封孔方式 */
  method: SealMethod;
  /** 封孔起止深度（m） */
  fromDepth: number;
  toDepth: number;
  /** 水泥用量（kg） */
  cementKg: number;
  /** 施工班组 */
  team: string;
  /** 封孔日期 ISO */
  sealedAt: string;
  /** 记录人 */
  recorder: string;
  /** 备注 */
  remark?: string;
  /** 是否升级回填的旧封孔记录（只读，不可编辑/提交） */
  legacy?: boolean;
  /** 班组这份的提交状态 */
  submitStatus: SealSubmitStatus;
  /** 提交时间 ISO */
  submittedAt?: string;
}

/** 对账状态 */
export type SealReconcileStatus = '无要求' | '未封孔' | '合格' | '待重新确认' | '退回补封';

/** 对账结果（派生，不落库） */
export interface SealReconcile {
  holeId: string;
  requirement?: SealRequirement;
  record?: SealRecord;
  /** 未被封孔段盖住的需保护矿化段 */
  uncovered: ProtectedSection[];
  status: SealReconcileStatus;
  /** 状态文案 */
  statusText: string;
}
