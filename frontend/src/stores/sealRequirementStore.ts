import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { buildRequiredRanges, requirementSignature } from '../utils/sealing';
import type { DepthSpan, SealKind, SealRequirement } from '../types/sealing';

export interface RequirementInput {
  holeId: string;
  finalDepth: number;
  mineralRanges: DepthSpan[];
  sealKind: SealKind;
  /** 分段封闭时手工维护的要求封闭段 */
  customRanges?: DepthSpan[];
  logger: string;
  remark?: string;
}

interface RequirementState {
  requirements: SealRequirement[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  byHole: (holeId: string) => SealRequirement | undefined;
  /**
   * 编录室侧保存：只写 sealRequirements 表。
   * 终孔深度 / 矿化段 / 封孔要求内容改动（签名变化）时版本 +1，
   * 先前判定合格的孔随之需要重新确认、工作台合格率重算。
   */
  saveRequirement: (input: RequirementInput) => Promise<{ requirement: SealRequirement; versionBumped: boolean }>;
}

/** 编录室侧：终孔深度、矿化段与封孔要求（班组封孔记录不在本侧写入） */
export const useRequirementStore = create<RequirementState>()((set, get) => ({
  requirements: [],
  hydrated: false,

  hydrate: async () => {
    const requirements = await db.sealRequirements.toArray();
    set({ requirements, hydrated: true });
  },

  byHole: (holeId) => get().requirements.find((r) => r.holeId === holeId),

  saveRequirement: async (input) => {
    const finalDepth = Number(input.finalDepth) || 0;
    const requiredRanges = buildRequiredRanges(input.sealKind, finalDepth, input.mineralRanges, input.customRanges ?? []);
    const signature = requirementSignature(finalDepth, input.mineralRanges, requiredRanges);
    const now = new Date().toISOString();
    const current = get().requirements.find((r) => r.holeId === input.holeId);

    const versionBumped = Boolean(current && current.signature !== signature);
    const requirement: SealRequirement = current
      ? {
          ...current,
          finalDepth,
          mineralRanges: input.mineralRanges,
          sealKind: input.sealKind,
          requiredRanges,
          logger: input.logger.trim(),
          remark: input.remark?.trim() || undefined,
          signature,
          updatedAt: now,
          version: versionBumped ? current.version + 1 : current.version,
        }
      : {
          id: uid('sealreq'),
          holeId: input.holeId,
          finalDepth,
          mineralRanges: input.mineralRanges,
          sealKind: input.sealKind,
          requiredRanges,
          version: 1,
          source: 'logging',
          logger: input.logger.trim(),
          signature,
          createdAt: now,
          updatedAt: now,
          remark: input.remark?.trim() || undefined,
        };

    await db.sealRequirements.put(requirement);
    set({ requirements: get().requirements.map((r) => (r.holeId === requirement.holeId ? requirement : r)).concat(current ? [] : [requirement]) });
    return { requirement, versionBumped };
  },
}));
