import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Descriptions, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import StatBadge from '../components/common/StatBadge';
import RequirementModal from '../components/sealing/RequirementModal';
import CrewSealModal from '../components/sealing/CrewSealModal';
import type { DrillHole } from '../types/drill-hole';
import { useHoleStore } from '../stores/holeStore';
import { useRequirementStore } from '../stores/sealRequirementStore';
import { useSealRecordStore } from '../stores/sealRecordStore';
import { RECONCILE_STATUS_META, totalCement, type SealRecord, type SealReconcile } from '../types/sealing';
import { reconcileHole, summarizeSeals } from '../utils/sealing';

const { Title, Paragraph, Text } = Typography;

type ModalState =
  | { kind: 'requirement'; holeId: string }
  | { kind: 'crew'; holeId: string }
  | { kind: 'legacy'; holeId: string; record: SealRecord }
  | null;

function fmtRanges(ranges: Array<{ from: number; to: number }>): string {
  return ranges.length ? ranges.map((r) => `${r.from}~${r.to}m`).join('、') : '—';
}

/** 封孔对账：编录室管要求（终孔深度/矿化段/封孔要求），班组管封孔（方式/起止/水泥），按矿化段对账 */
export default function SealReconcilePage() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const requirements = useRequirementStore((s) => s.requirements);
  const records = useSealRecordStore((s) => s.records);
  const reconfirm = useSealRecordStore((s) => s.reconfirm);

  const [modal, setModal] = useState<ModalState>(null);

  const reconciles = useMemo<SealReconcile[]>(
    () =>
      holes.map((hole) => {
        const req = requirements.find((r) => r.holeId === hole.id);
        const recs = records.filter((r) => r.holeId === hole.id);
        return reconcileHole(req, recs);
      }),
    [holes, requirements, records],
  );

  const finishedReconciles = reconciles.filter((r) => r.requirement);
  const summary = useMemo(() => summarizeSeals(reconciles), [reconciles]);

  const holeById = (id: string): DrillHole => holes.find((h) => h.id === id) as DrillHole;

  const handleReconfirm = async (rec: SealReconcile) => {
    if (!rec.requirement) return;
    const next = await reconfirm(rec.holeId, rec.requirement);
    if (!next) return;
    if (next.verdict === 'qualified') {
      message.success(`已按封孔要求 v${rec.requirement.version} 重新确认：封孔段盖住全部保护矿化段，判定合格，合格率已重算`);
    } else {
      message.warning(`重新确认未过：${(next.uncoveredAtCheck ?? []).map((r) => `${r.from}~${r.to}m`).join('、')} 仍未盖住，本条退回补封`);
    }
  };

  const columns: TableColumnsType<SealReconcile> = [
    {
      title: '孔号 / 班组',
      width: 150,
      render: (_, row) => {
        const hole = holeById(row.holeId);
        return (
          <div>
            <Text strong>{hole?.holeNo}</Text>
            <div style={{ fontSize: 12, color: '#6b7a86' }}>
              {hole?.rigNo} · {hole?.shift}
            </div>
          </div>
        );
      },
    },
    {
      title: '编录室：终孔深度 / 矿化段 / 封孔要求',
      width: 300,
      render: (_, row) =>
        row.requirement ? (
          <Space direction="vertical" size={2}>
            <Text>终孔 {row.requirement.finalDepth}m · v{row.requirement.version}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              矿化段：{fmtRanges(row.requirement.mineralRanges)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.requirement.sealKind}，要求封 {fmtRanges(row.requirement.requiredRanges)}
            </Text>
          </Space>
        ) : (
          <Tag>未终孔，无封孔要求</Tag>
        ),
    },
    {
      title: '班组：封孔方式 / 封孔起止 / 水泥(t)',
      width: 280,
      render: (_, row) =>
        row.latest ? (
          <Space direction="vertical" size={2}>
            <Text>
              {row.latest.method} · 合计 {totalCement(row.latest)}t
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              实际封孔段：{fmtRanges(row.covered)}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.latest.operator} · {new Date(row.latest.sealedAt).toLocaleDateString()}
            </Text>
          </Space>
        ) : row.legacyMatched ? (
          <Space direction="vertical" size={2}>
            <Text type="secondary">{row.legacy[0].method}（旧留证只读）</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              封孔段：{fmtRanges(row.legacy.flatMap((r) => r.segments.map((s) => ({ from: s.fromDepth, to: s.toDepth }))))}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              水泥 {totalCement(row.legacy[0])}t · {new Date(row.legacy[0].sealedAt).toLocaleDateString()}
            </Text>
          </Space>
        ) : row.legacy.length ? (
          <Text type="secondary">仅旧留证（只读，对不上）</Text>
        ) : (
          <Tag color="orange">班组未报封孔</Tag>
        ),
    },
    {
      title: '对账（按矿化段）',
      width: 200,
      render: (_, row) => {
        const meta = RECONCILE_STATUS_META[row.status];
        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color}>
              {meta.label}
              {row.status === 'qualified' && row.legacyMatched ? ' · 旧留证只读' : ''}
            </Tag>
            {row.status === 'rejected' ? (
              <Text type="danger" style={{ fontSize: 12 }}>
                未盖住：{fmtRanges(row.uncovered)}
              </Text>
            ) : row.status === 'stale' ? (
              <Text type="warning" style={{ fontSize: 12 }}>
                判定依据 v{row.latest?.matchedVersion} 落后于要求 v{row.requirement?.version}
              </Text>
            ) : null}
            {row.legacy.length ? <Tag icon={<LockOutlined />}>旧留证 {row.legacy.length} 条（只读）</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '操作（两边各管各的）',
      width: 270,
      fixed: 'right',
      render: (_, row) => (
        <Space size={2} wrap>
          <Button size="small" onClick={() => setModal({ kind: 'requirement', holeId: row.holeId })}>
            {row.requirement ? '改封孔要求' : '提封孔要求'}
          </Button>
          <Button size="small" type="primary" ghost disabled={!row.requirement} onClick={() => setModal({ kind: 'crew', holeId: row.holeId })}>
            {row.status === 'rejected' ? '补封重报' : '报封孔记录'}
          </Button>
          {row.status === 'stale' ? (
            <Button size="small" type="primary" onClick={() => handleReconfirm(row)}>
              重新确认
            </Button>
          ) : null}
          {row.legacy[0] ? (
            <Button size="small" type="link" onClick={() => setModal({ kind: 'legacy', holeId: row.holeId, record: row.legacy[0] })}>
              查看旧留证
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        封孔对账
      </Title>
      <Paragraph type="secondary">
        两边各管自己那份：钻探班组管封孔方式、封孔起止深度与水泥用量；地质编录室管终孔深度、矿化段与封孔要求。按矿化段对账——该保护的矿化段没被封孔段盖住，
        班组那条退回补封，编录室要求原样留着。封孔要求改版后原合格孔需重新确认，工作台合格率一并重算。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="封孔合格率" value={summary.rate} unit="%" status={summary.rate >= 90 ? 'success' : summary.rate >= 60 ? 'warning' : 'error'} hint="合格孔数 / 已提封孔要求孔数；要求改版后一并重算" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="合格孔" value={summary.qualified} unit={`/ ${summary.requiredCount}`} status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="退回补封 / 待封孔" value={`${summary.rejected} / ${summary.waiting}`} status={summary.rejected ? 'error' : 'default'} hint="退回：矿化段没被封孔段盖住；待封孔：编录室已提要求，班组未报" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="待重新确认 / 旧留证孔" value={`${summary.stale} / ${summary.legacyCount}`} status={summary.stale ? 'warning' : 'default'} hint="要求改版后原合格判定失效；旧留证只读不计入合格率" />
        </Col>
      </Row>

      {summary.stale > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`封孔要求已改版：${summary.stale} 个先前合格的孔需要重新确认，合格率已按新要求重算，确认前不计为合格。`}
        />
      ) : null}
      {summary.rejected > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="error"
          showIcon
          message={`${summary.rejected} 个孔的班组封孔记录已退回补封（保护矿化段未盖住），编录室封孔要求保留未动。`}
        />
      ) : null}

      <Card size="small">
        <Table
          rowKey="holeId"
          size="small"
          columns={columns}
          dataSource={finishedReconciles.concat(reconciles.filter((r) => !r.requirement))}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1240 }}
          expandable={{
            expandedRowRender: (row) => <HoleSealHistory holeId={row.holeId} />,
            rowExpandable: (row) => records.some((r) => r.holeId === row.holeId),
          }}
        />
      </Card>

      {modal?.kind === 'requirement' ? (
        <RequirementModal
          open
          holeId={modal.holeId}
          requirement={requirements.find((r) => r.holeId === modal.holeId)}
          onClose={() => setModal(null)}
          onSaved={(bumped) => {
            setModal(null);
            if (bumped) message.info('封孔要求已升版，相关孔的合格判定已置为待重新确认，合格率已重算');
          }}
        />
      ) : null}
      {modal?.kind === 'crew' ? <CrewSealModal open holeId={modal.holeId} onClose={() => setModal(null)} /> : null}
      {modal?.kind === 'legacy' ? <CrewSealModal open holeId={modal.holeId} legacyRecord={modal.record} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

/** 展开行：该孔班组全部封孔记录（含退回留痕与旧留证），两边字段分栏只读 */
function HoleSealHistory({ holeId }: { holeId: string }) {
  const records = useSealRecordStore((s) => s.records.filter((r) => r.holeId === holeId));
  const requirement = useRequirementStore((s) => s.requirements.find((r) => r.holeId === holeId));
  if (records.length === 0) return <Text type="secondary">该孔暂无班组封孔记录。</Text>;

  return (
    <Descriptions column={1} size="small" bordered styles={{ label: { width: 130 } }}>
      {requirement ? (
        <Descriptions.Item label="编录室要求（只读参照）">
          v{requirement.version} · {requirement.sealKind} · 矿化段 {fmtRanges(requirement.mineralRanges)} · 要求封 {fmtRanges(requirement.requiredRanges)}
        </Descriptions.Item>
      ) : null}
      {records
        .sort((a, b) => b.sealedAt.localeCompare(a.sealedAt))
        .map((rec) => (
          <Descriptions.Item
            key={rec.id}
            label={
              <Space size={4}>
                {rec.legacy ? <Tag icon={<LockOutlined />}>旧留证</Tag> : null}
                <Tag color={rec.verdict === 'qualified' ? 'green' : rec.verdict === 'rejected' ? 'red' : 'orange'}>
                  {rec.verdict === 'qualified' ? '合格' : rec.verdict === 'rejected' ? '退回补封' : '待判定'}
                </Tag>
              </Space>
            }
          >
            <Space direction="vertical" size={2}>
              <Text>
                {rec.method} · {rec.segments.map((s) => `${s.fromDepth}~${s.toDepth}m（${s.cementTons}t）`).join('、')} · 水泥合计 {totalCement(rec)}t
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {rec.shift} · {rec.operator} · 封孔 {new Date(rec.sealedAt).toLocaleDateString()}
                {rec.checkedAt ? ` · 对账 ${new Date(rec.checkedAt).toLocaleDateString()}` : ''} · 依据要求 v{rec.matchedVersion}
              </Text>
              {rec.uncoveredAtCheck?.length ? (
                <Text type="danger" style={{ fontSize: 12 }}>
                  退回原因：{fmtRanges(rec.uncoveredAtCheck)} 未被封孔段盖住
                </Text>
              ) : null}
              {rec.remark ? <Text type="secondary" style={{ fontSize: 12 }}>{rec.remark}</Text> : null}
            </Space>
          </Descriptions.Item>
        ))}
    </Descriptions>
  );
}
