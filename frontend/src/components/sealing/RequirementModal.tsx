import { useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography } from 'antd';
import SpanEditor, { newSpanKey, type EditableSpan } from '../common/SpanEditor';
import { useHoleStore } from '../../stores/holeStore';
import { useLithoStore } from '../../stores/lithoStore';
import { useRequirementStore } from '../../stores/sealRequirementStore';
import { SEAL_KINDS, type DepthSpan, type SealKind, type SealRequirement } from '../../types/sealing';
import { buildRequiredRanges, extractMineralRanges, requirementSignature } from '../../utils/sealing';
import { validateRange } from '../../utils/recovery';

const { Text } = Typography;

interface RequirementModalProps {
  open: boolean;
  holeId: string;
  requirement?: SealRequirement;
  onClose: () => void;
  onSaved: (versionBumped: boolean) => void;
}

interface FormShape {
  finalDepth: number;
  sealKind: SealKind;
  logger: string;
  remark?: string;
}

const toRows = (ranges: DepthSpan[]): EditableSpan[] => ranges.map((r) => ({ key: newSpanKey(), from: r.from, to: r.to }));
const toSpans = (rows: EditableSpan[]): DepthSpan[] => rows.map((r) => ({ from: Number(r.from) || 0, to: Number(r.to) || 0 }));
const fmtRanges = (rs: DepthSpan[]) => rs.map((r) => `${r.from}~${r.to}`).join('、');

/** 编录室侧弹窗：管终孔深度、要保护的矿化段与封孔要求；只写封孔要求表 */
export default function RequirementModal({ open, holeId, requirement, onClose, onSaved }: RequirementModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormShape>();
  const holes = useHoleStore((s) => s.holes);
  const lithos = useLithoStore((s) => s.lithos);
  const saveRequirement = useRequirementStore((s) => s.saveRequirement);

  const hole = holes.find((h) => h.id === holeId);
  const lithoMinerals = useMemo(() => extractMineralRanges(lithos.filter((l) => l.holeId === holeId)), [lithos, holeId]);

  const [sealKind, setSealKind] = useState<SealKind>('矿化段封闭');
  const [finalDepth, setFinalDepth] = useState<number>(0);
  const [mineralRows, setMineralRows] = useState<EditableSpan[]>([]);
  const [customRows, setCustomRows] = useState<EditableSpan[]>([]);

  useEffect(() => {
    if (!open) return;
    const kind = requirement?.sealKind ?? (lithoMinerals.length ? '矿化段封闭' : '整孔封闭');
    form.setFieldsValue({
      finalDepth: requirement?.finalDepth ?? hole?.finalDepth ?? 0,
      sealKind: kind,
      logger: requirement?.logger ?? '',
      remark: requirement?.remark,
    });
    setSealKind(kind);
    setFinalDepth(requirement?.finalDepth ?? hole?.finalDepth ?? 0);
    setMineralRows(toRows(requirement?.mineralRanges ?? lithoMinerals));
    setCustomRows(toRows(requirement?.sealKind === '分段封闭' ? requirement.requiredRanges : []));
  }, [open, holeId, requirement, hole, lithoMinerals, form]);

  const mineralRanges = toSpans(mineralRows);
  const requiredRanges = useMemo(
    () => buildRequiredRanges(sealKind, finalDepth, mineralRanges, toSpans(customRows)),
    [sealKind, finalDepth, mineralRows, customRows],
  );

  // 与岩性编录当前矿化段不一致时提醒（矿化段以本侧确认为准，不自动联动）
  const lithoDiff = lithoMinerals.length > 0 && fmtRanges(lithoMinerals) !== fmtRanges(mineralRanges);

  // 内容签名变化即需要升版（终孔深度 / 矿化段 / 要求封闭段任一改动）
  const nextSignature = requirementSignature(finalDepth, mineralRanges, requiredRanges);
  const willBump = Boolean(requirement && requirement.signature !== nextSignature);

  const firstRangeError = (rows: EditableSpan[]) => rows.map((r) => validateRange(Number(r.from), Number(r.to))).find(Boolean);

  const doSave = async () => {
    const values = await form.validateFields();
    const depth = Number(values.finalDepth);
    await saveRequirement({
      holeId,
      finalDepth: depth,
      mineralRanges,
      sealKind: values.sealKind,
      customRanges: toSpans(customRows),
      logger: values.logger,
      remark: values.remark,
    });
    message.success('编录室封孔要求已保存（班组封孔记录未改动）');
    onSaved(willBump);
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (Number(values.finalDepth) <= 0) {
      message.error('终孔深度必须大于 0（未终孔孔不提封孔要求）');
      return;
    }
    const mineralError = firstRangeError(mineralRows);
    if (mineralError) {
      message.error(`矿化段深度有误：${mineralError}`);
      return;
    }
    if (values.sealKind === '分段封闭' && (customRows.length === 0 || firstRangeError(customRows))) {
      message.error('分段封闭需至少一条起止深度正确的要求封闭段');
      return;
    }
    if (willBump) {
      Modal.confirm({
        title: '封孔要求内容已改动',
        content: '保存后要求版本将 +1，先前判定合格的孔需重新确认，工作台封孔合格率一并重算。确认保存？',
        okText: '保存并升版',
        cancelText: '取消',
        onOk: doSave,
      });
      return;
    }
    await doSave();
  };

  if (!hole) return null;

  return (
    <Modal open={open} title={`封孔要求（编录室）· ${hole.holeNo}`} onCancel={onClose} onOk={submit} okText="保存要求" cancelText="取消" width={760} forceRender>
      {requirement ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message={
            <Space wrap size={4}>
              <span>当前要求版本 v{requirement.version}</span>
              <Tag color={requirement.source === 'legacy-backfill' ? 'default' : 'blue'}>
                {requirement.source === 'legacy-backfill' ? '老孔按终孔深度回填' : '编录室编制'}
              </Tag>
              {willBump ? <Tag color="gold">保存后升版为 v{requirement.version + 1}</Tag> : null}
              <span style={{ color: '#6b7a86' }}>最近更新 {new Date(requirement.updatedAt).toLocaleDateString()}</span>
            </Space>
          }
        />
      ) : (
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="该孔尚无封孔要求，由编录室新建；班组侧不能代写本侧数据。" />
      )}

      <Form form={form} layout="vertical">
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="finalDepth" label="终孔深度(m)（编录室持有）" rules={[{ required: true, message: '请输入终孔深度' }]}>
            <InputNumber min={0} style={{ width: 200 }} onChange={(v) => setFinalDepth(Number(v) || 0)} />
          </Form.Item>
          <Form.Item name="sealKind" label="封孔类型" rules={[{ required: true }]}>
            <Select style={{ width: 170 }} options={SEAL_KINDS.map((v) => ({ label: v, value: v }))} onChange={(v: SealKind) => setSealKind(v)} />
          </Form.Item>
          <Form.Item name="logger" label="编录人" rules={[{ required: true, message: '请输入编录人' }]}>
            <Input style={{ width: 150 }} maxLength={16} placeholder="编录人" />
          </Form.Item>
        </Space>
        {hole.finalDepth > 0 && finalDepth > 0 && finalDepth !== hole.finalDepth ? (
          <Alert style={{ marginBottom: 12 }} type="warning" showIcon message={`编录室终孔深度 ${finalDepth}m 与钻孔台帐 ${hole.finalDepth}m 不一致，以编录室这份为准，可在保存前核对。`} />
        ) : null}

        <Form.Item label="要保护的矿化段（对账基准）" required>
          <SpanEditor rows={mineralRows} onChange={setMineralRows} addText="新增矿化段" maxDepth={finalDepth || undefined} />
        </Form.Item>
        {lithoDiff ? (
          <Alert
            style={{ marginBottom: 12 }}
            type="warning"
            showIcon
            message={`与岩性编录当前矿化段（${fmtRanges(lithoMinerals) || '无'}）不一致，矿化段以编录室确认为准，不会自动联动修改。`}
          />
        ) : lithoMinerals.length > 0 ? (
          <Text type="secondary">矿化段已按岩性编录自动提取，可在本侧调整确认。</Text>
        ) : null}

        {sealKind === '分段封闭' ? (
          <Form.Item label="要求封闭段（分段封闭手工维护）" required style={{ marginTop: 12 }}>
            <SpanEditor rows={customRows} onChange={setCustomRows} addText="新增要求段" maxDepth={finalDepth || undefined} />
          </Form.Item>
        ) : null}

        <Alert
          style={{ marginTop: 8 }}
          type="success"
          showIcon
          message={
            sealKind === '整孔封闭'
              ? `要求封闭段：0 ~ ${finalDepth}m（按终孔深度整孔封闭）`
              : `要求封闭段：${requiredRanges.map((r) => `${r.from}~${r.to}m`).join('、') || '无'}`
          }
        />
        <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={120} placeholder="封孔要求说明" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
