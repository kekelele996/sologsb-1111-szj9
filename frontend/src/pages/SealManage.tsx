import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, DatePicker, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import DepthRangeInput from '../components/common/DepthRangeInput';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHoleStore } from '../stores/holeStore';
import { useLithoStore } from '../stores/lithoStore';
import { useSealStore } from '../stores/sealStore';
import { SHIFTS } from '../types/drill-hole';
import { SEAL_METHODS, type ProtectedSection, type SealMethod, type SealReconcile } from '../types/seal';
import { estimateCementKg, reconcileSeal, sealQualifiedRate, suggestedProtectedSections } from '../utils/seal';
import { uid } from '../utils/id';
import { validateRange } from '../utils/recovery';

const { Title, Paragraph, Text } = Typography;

const STATUS_COLOR: Record<SealReconcile['status'], string> = {
  合格: 'green',
  待重新确认: 'orange',
  退回补封: 'red',
  未封孔: 'default',
  无要求: 'default',
};

/** 封孔管理：钻探班组管封孔方式/起止深度/水泥用量，地质编录室管终孔深度/矿化段/封孔要求，两边按矿化段对账 */
export default function SealManage() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const currentHoleId = useHoleStore((s) => s.currentHoleId);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const lithos = useLithoStore((s) => s.lithos);
  const requirements = useSealStore((s) => s.requirements);
  const records = useSealStore((s) => s.records);
  const upsertRequirement = useSealStore((s) => s.upsertRequirement);
  const submitRequirement = useSealStore((s) => s.submitRequirement);
  const confirmRequirement = useSealStore((s) => s.confirmRequirement);
  const upsertRecord = useSealStore((s) => s.upsertRecord);
  const submitRecord = useSealStore((s) => s.submitRecord);
  const removeRecord = useSealStore((s) => s.removeRecord);

  const activeHoleId = currentHoleId || holes[0]?.id || '';
  const activeHole = holes.find((h) => h.id === activeHoleId);
  const requirement = requirements.find((r) => r.holeId === activeHoleId);
  const record = records.find((r) => r.holeId === activeHoleId);
  const reconcile = activeHole ? reconcileSeal(activeHole, requirement, record) : undefined;

  /** 全孔对账（工作台合格率口径） */
  const allReconciles = useMemo(
    () =>
      holes.map((h) =>
        reconcileSeal(
          h,
          requirements.find((r) => r.holeId === h.id),
          records.find((r) => r.holeId === h.id),
        ),
      ),
    [holes, requirements, records],
  );
  const rate = useMemo(() => sealQualifiedRate(allReconciles), [allReconciles]);

  // 编录室要求表单
  const [reqSections, setReqSections] = useState<ProtectedSection[]>([]);
  const [reqText, setReqText] = useState('');
  const [reqSetBy, setReqSetBy] = useState('');
  const [reqFormOpen, setReqFormOpen] = useState(false);
  // 班组记录表单
  const [recMethod, setRecMethod] = useState<SealMethod>('水泥浆封孔');
  const [recRange, setRecRange] = useState<{ from: number; to: number }>({ from: 0, to: 0 });
  const [recCement, setRecCement] = useState(0);
  const [recTeam, setRecTeam] = useState('甲班');
  const [recSealedAt, setRecSealedAt] = useState<Dayjs>(dayjs());
  const [recRecorder, setRecRecorder] = useState('');
  const [recRemark, setRecRemark] = useState('');
  const [recFormOpen, setRecFormOpen] = useState(false);

  const derivedSections = useMemo(
    () => suggestedProtectedSections(lithos, activeHoleId),
    [lithos, activeHoleId],
  );

  const openReqForm = () => {
    if (requirement) {
      setReqSections(requirement.protectedSections);
      setReqText(requirement.requirement);
      setReqSetBy(requirement.setBy);
    } else {
      setReqSections(derivedSections);
      setReqText('');
      setReqSetBy('');
    }
    setReqFormOpen(true);
  };

  const openRecForm = () => {
    if (record) {
      setRecMethod(record.method);
      setRecRange({ from: record.fromDepth, to: record.toDepth });
      setRecCement(record.cementKg);
      setRecTeam(record.team);
      setRecSealedAt(dayjs(record.sealedAt));
      setRecRecorder(record.recorder);
      setRecRemark(record.remark ?? '');
    } else {
      const to = activeHole?.finalDepth || activeHole?.designDepth || 0;
      setRecMethod('水泥浆封孔');
      setRecRange({ from: 0, to });
      setRecCement(estimateCementKg('水泥浆封孔', 0, to));
      setRecTeam(activeHole?.shift || '甲班');
      setRecSealedAt(dayjs());
      setRecRecorder('');
      setRecRemark('');
    }
    setRecFormOpen(true);
  };

  const saveRequirement = async () => {
    if (!activeHoleId) return;
    if (reqSections.length === 0) {
      message.warning('请至少添加一个需保护矿化段');
      return;
    }
    await upsertRequirement({
      holeId: activeHoleId,
      protectedSections: reqSections,
      requirement: reqText,
      setBy: reqSetBy,
    });
    message.success(requirement ? '封孔要求已更新（版本 +1，先前合格判定需重新确认）' : '封孔要求已制定');
    setReqFormOpen(false);
  };

  const saveRecord = async () => {
    if (!activeHoleId) return;
    const err = validateRange(recRange.from, recRange.to);
    if (err) {
      message.error(err);
      return;
    }
    await upsertRecord({
      holeId: activeHoleId,
      method: recMethod,
      fromDepth: recRange.from,
      toDepth: recRange.to,
      cementKg: recCement,
      team: recTeam,
      sealedAt: recSealedAt.toISOString(),
      recorder: recRecorder,
      remark: recRemark,
    });
    message.success(record ? '封孔记录已更新（本方提交状态回到未提交）' : '封孔记录已录入');
    setRecFormOpen(false);
  };

  const handleSubmitRequirement = async () => {
    if (!requirement) return;
    try {
      await submitRequirement(requirement.id);
      message.success('编录室封孔要求已提交');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleSubmitRecord = async () => {
    if (!record) return;
    try {
      await submitRecord(record.id);
      message.success('班组封孔记录已提交');
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleConfirm = async () => {
    if (!requirement) return;
    await confirmRequirement(requirement.id);
    message.success('已重新确认');
  };

  const holeOptions = holes.map((h) => ({ label: `${h.holeNo} · 终孔 ${h.finalDepth || '-'}m`, value: h.id }));
  const requirementChanged =
    requirement !== undefined && requirement.confirmedVersion !== undefined && requirement.confirmedVersion < requirement.version;

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        封孔管理
      </Title>
      <Paragraph type="secondary">
        钻探班组管封孔方式、起止深度与水泥用量；地质编录室管终孔深度、矿化段与封孔要求。两边按矿化段对账，该保护的矿化段没被封孔段盖住即退回补封；要求改动后先前合格孔重新确认。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <span style={{ color: '#6b7a86' }}>当前钻孔</span>
        <Select style={{ width: 240 }} value={activeHoleId} onChange={setCurrentHole} options={holeOptions} placeholder="选择钻孔" />
        {reconcile ? <Tag color={STATUS_COLOR[reconcile.status]}>{reconcile.statusText}</Tag> : null}
        <Tag color="blue">
          封孔合格率 {rate.rate}%（{rate.qualified}/{rate.total}）
        </Tag>
      </Space>

      {!activeHole ? (
        <EmptyPanel description="请选择钻孔" />
      ) : (
        <>
          <Row gutter={[16, 16]}>
            {/* 地质编录室那份 */}
            <Col xs={24} lg={12}>
              <Card
                title="地质编录室 · 封孔要求"
                size="small"
                extra={requirement ? <Tag color={requirementChanged ? 'orange' : 'default'}>v{requirement.version}{requirementChanged ? ' · 待重新确认' : ''}</Tag> : null}
              >
                {requirement ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Text type="secondary">需保护矿化段：</Text>
                    <Space wrap>
                      {requirement.protectedSections.map((s) => (
                        <Tag key={s.id} color="geekblue">
                          {s.fromDepth}~{s.toDepth}m{s.note ? ` · ${s.note}` : ''}
                        </Tag>
                      ))}
                    </Space>
                    <Text>要求说明：{requirement.requirement || '-'}</Text>
                    <Text type="secondary">
                      制定人 {requirement.setBy} · {dayjs(requirement.setAt).format('YYYY-MM-DD HH:mm')}
                    </Text>
                    <Space>
                      <Tag color={requirement.submitStatus === '已提交' ? 'green' : requirement.submitStatus === '提交失败' ? 'red' : 'default'}>
                        {requirement.submitStatus}
                      </Tag>
                      <Button size="small" onClick={openReqForm}>
                        编辑要求
                      </Button>
                      <Button size="small" type="primary" onClick={handleSubmitRequirement} disabled={requirement.submitStatus === '已提交'}>
                        {requirement.submitStatus === '提交失败' ? '重试提交' : '提交'}
                      </Button>
                    </Space>
                  </Space>
                ) : (
                  <Space direction="vertical" size={8}>
                    <Text type="secondary">该孔尚未制定封孔要求（老孔升级回填整孔封闭记录）。</Text>
                    <Button type="primary" onClick={openReqForm}>
                      制定封孔要求
                    </Button>
                  </Space>
                )}
              </Card>
            </Col>

            {/* 钻探班组那份 */}
            <Col xs={24} lg={12}>
              <Card
                title="钻探班组 · 封孔记录"
                size="small"
                extra={record?.legacy ? <Tag color="default">只读 · 历史封孔记录</Tag> : null}
              >
                {record ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Text>封孔方式：{record.method}</Text>
                    <Text>
                      封孔段：{record.fromDepth}~{record.toDepth}m · 水泥 {record.cementKg}kg
                    </Text>
                    <Text type="secondary">
                      班组 {record.team} · 封孔 {dayjs(record.sealedAt).format('YYYY-MM-DD')} · 记录人 {record.recorder}
                    </Text>
                    {record.remark ? <Text type="secondary">备注：{record.remark}</Text> : null}
                    {record.legacy ? (
                      <Alert type="info" showIcon message="升级前老孔，按终孔深度回填整孔封闭，只读不可编辑" />
                    ) : (
                      <Space>
                        <Tag color={record.submitStatus === '已提交' ? 'green' : record.submitStatus === '提交失败' ? 'red' : 'default'}>
                          {record.submitStatus}
                        </Tag>
                        <Button size="small" onClick={openRecForm}>
                          编辑记录
                        </Button>
                        <Button size="small" type="primary" onClick={handleSubmitRecord} disabled={record.submitStatus === '已提交'}>
                          {record.submitStatus === '提交失败' ? '重试提交' : '提交'}
                        </Button>
                        <Popconfirm
                          title="确认删除该封孔记录？"
                          onConfirm={() => removeRecord(record.id).then(() => message.success('已删除'))}
                        >
                          <Button size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    )}
                  </Space>
                ) : (
                  <Space direction="vertical" size={8}>
                    <Text type="secondary">该孔尚无封孔记录。</Text>
                    <Button type="primary" onClick={openRecForm} disabled={!activeHole.finalDepth}>
                      录入封孔记录
                    </Button>
                  </Space>
                )}
              </Card>
            </Col>
          </Row>

          {/* 对账结果 */}
          <Card title="对账结果" size="small" style={{ marginTop: 16 }}>
            {reconcile?.status === '合格' ? (
              <Alert type="success" showIcon message="对账合格：需保护矿化段已被封孔段全部盖住" />
            ) : reconcile?.status === '待重新确认' ? (
              <Alert
                type="warning"
                showIcon
                message="封孔要求已变更，先前合格判定需重新确认"
                description={`当前要求 v${requirement?.version}，上次确认 v${requirement?.confirmedVersion}`}
                action={
                  <Button size="small" type="primary" onClick={handleConfirm}>
                    重新确认
                  </Button>
                }
              />
            ) : reconcile?.status === '退回补封' ? (
              <Alert
                type="error"
                showIcon
                message="退回补封：以下需保护矿化段未被封孔段盖住"
                description={
                  <Space wrap>
                    {reconcile.uncovered.map((s) => (
                      <Tag key={s.id} color="red">
                        {s.fromDepth}~{s.toDepth}m{s.note ? ` · ${s.note}` : ''}
                      </Tag>
                    ))}
                  </Space>
                }
                action={
                  <Button size="small" type="primary" onClick={openRecForm}>
                    去补封
                  </Button>
                }
              />
            ) : reconcile?.status === '未封孔' ? (
              <Alert type="warning" showIcon message="尚未封孔：班组提交封孔记录后自动对账" />
            ) : (
              <Alert type="info" showIcon message="无封孔要求：老孔升级回填整孔封闭记录，只读保存" />
            )}
          </Card>
        </>
      )}

      {/* 编录室要求编辑弹窗 */}
      <Modal
        open={reqFormOpen}
        title={requirement ? '编辑封孔要求' : '制定封孔要求'}
        onCancel={() => setReqFormOpen(false)}
        onOk={saveRequirement}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Space style={{ marginBottom: 6 }} wrap>
              <Text strong>需保护矿化段</Text>
              <Button size="small" onClick={() => setReqSections(derivedSections)}>
                从矿化编录派生
              </Button>
              <Button
                size="small"
                onClick={() => setReqSections([...reqSections, { id: uid('sec'), fromDepth: 0, toDepth: 0 }])}
              >
                添加一段
              </Button>
            </Space>
            {reqSections.map((s, idx) => (
              <Space key={s.id} style={{ display: 'flex', marginBottom: 6 }} align="center" wrap>
                <span style={{ color: '#6b7a86' }}>起</span>
                <InputNumber
                  min={0}
                  value={s.fromDepth}
                  onChange={(v) => {
                    const next = [...reqSections];
                    next[idx] = { ...s, fromDepth: Number(v) || 0 };
                    setReqSections(next);
                  }}
                  addonAfter="m"
                  style={{ width: 120 }}
                />
                <span style={{ color: '#6b7a86' }}>止</span>
                <InputNumber
                  min={0}
                  value={s.toDepth}
                  onChange={(v) => {
                    const next = [...reqSections];
                    next[idx] = { ...s, toDepth: Number(v) || 0 };
                    setReqSections(next);
                  }}
                  addonAfter="m"
                  style={{ width: 120 }}
                />
                <Input
                  value={s.note}
                  onChange={(e) => {
                    const next = [...reqSections];
                    next[idx] = { ...s, note: e.target.value };
                    setReqSections(next);
                  }}
                  placeholder="矿化类型"
                  style={{ width: 140 }}
                />
                <Button size="small" danger onClick={() => setReqSections(reqSections.filter((_, i) => i !== idx))}>
                  删除
                </Button>
              </Space>
            ))}
          </div>
          <Input.TextArea rows={3} value={reqText} onChange={(e) => setReqText(e.target.value)} placeholder="封孔要求说明" />
          <Input value={reqSetBy} onChange={(e) => setReqSetBy(e.target.value)} placeholder="制定人" maxLength={16} />
        </Space>
      </Modal>

      {/* 班组记录编辑弹窗 */}
      <Modal
        open={recFormOpen}
        title={record ? '编辑封孔记录' : '录入封孔记录'}
        onCancel={() => setRecFormOpen(false)}
        onOk={saveRecord}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space wrap>
            <span style={{ color: '#6b7a86' }}>封孔方式</span>
            <Select style={{ width: 160 }} value={recMethod} onChange={setRecMethod} options={SEAL_METHODS.map((m) => ({ label: m, value: m }))} />
            <span style={{ color: '#6b7a86' }}>班组</span>
            <Select style={{ width: 120 }} value={recTeam} onChange={setRecTeam} options={SHIFTS.map((s) => ({ label: s, value: s }))} />
          </Space>
          <DepthRangeInput
            fromDepth={recRange.from}
            toDepth={recRange.to}
            referenceRuns={[]}
            maxDepth={activeHole?.finalDepth || activeHole?.designDepth}
            onChange={(patch) => setRecRange((prev) => ({ ...prev, ...patch }))}
          />
          <Space wrap>
            <span style={{ color: '#6b7a86' }}>水泥用量</span>
            <InputNumber
              min={0}
              value={recCement}
              onChange={(v) => setRecCement(Number(v) || 0)}
              addonAfter="kg"
              style={{ width: 140 }}
            />
            <Button
              size="small"
              onClick={() => setRecCement(estimateCementKg(recMethod, recRange.from, recRange.to))}
            >
              估算
            </Button>
            <DatePicker value={recSealedAt} onChange={(v) => setRecSealedAt(v ?? dayjs())} />
            <Input value={recRecorder} onChange={(e) => setRecRecorder(e.target.value)} placeholder="记录人" maxLength={16} style={{ width: 120 }} />
          </Space>
          <Input.TextArea rows={2} value={recRemark} onChange={(e) => setRecRemark(e.target.value)} placeholder="备注" maxLength={60} />
        </Space>
      </Modal>
    </div>
  );
}
