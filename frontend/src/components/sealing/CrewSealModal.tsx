import { useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Checkbox, DatePicker, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import SpanEditor, { newSpanKey, type EditableSpan } from '../common/SpanEditor';
import { SHIFTS } from '../../types/drill-hole';
import { useRequirementStore } from '../../stores/sealRequirementStore';
import { CrewSubmitError, useSealRecordStore } from '../../stores/sealRecordStore';
import { SEAL_METHODS, totalCement, type SealMethod, type SealRecord } from '../../types/sealing';
import { uncoveredParts } from '../../utils/sealing';
import { validateRange } from '../../utils/recovery';

const { Text } = Typography;

interface CrewModalProps {
  open: boolean;
  holeId: string;
  /** 只读旧留证时传入（班组不可改） */
  legacyRecord?: SealRecord;
  onClose: () => void;
}

interface FormShape {
  method: SealMethod;
  sealedAt: Dayjs;
  shift: string;
  operator: string;
  remark?: string;
}

/** 班组侧弹窗：封孔方式、封孔起止深度与水泥用量；只写封孔记录表；提交失败只在本侧重试 */
export default function CrewSealModal({ open, holeId, legacyRecord, onClose }: CrewModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormShape>();
  const requirement = useRequirementStore((s) => s.requirements.find((r) => r.holeId === holeId));
  const submitRecord = useSealRecordStore((s) => s.submitRecord);
  const records = useSealRecordStore((s) => s.records);

  const [segments, setSegments] = useState<EditableSpan[]>([]);
  const [forceFail, setForceFail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** 提交失败后保留输入：按本侧重试时直接重放，编录室那份完全不碰 */
  const [lastError, setLastError] = useState<string>('');
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!open) return;
    setForceFail(false);
    setLastError('');
    setAttempts(0);
    setSegments([{ key: newSpanKey(), from: 0, to: requirement?.finalDepth ?? 0, cementTons: 0 }]);
    form.setFieldsValue({
      method: '分段水泥封闭',
      sealedAt: dayjs(),
      shift: SHIFTS[0],
      operator: '',
    });
  }, [open, holeId, requirement, form]);

  const holeRecords = records.filter((r) => r.holeId === holeId && !r.legacy);
  const cement = useMemo(() => segments.reduce((sum, s) => sum + (Number(s.cementTons) || 0), 0), [segments]);

  // 按当前表单实时对账（矿化段口径），供班组提交前自查
  const preview = useMemo(() => {
    if (!requirement) return undefined;
    const draftSegs = segments.map((s) => ({ from: Number(s.from) || 0, to: Number(s.to) || 0 }));
    const merged = [...holeRecords.flatMap((r) => r.segments.map((s) => ({ from: s.fromDepth, to: s.toDepth }))), ...draftSegs];
    const targets = requirement.mineralRanges.length ? requirement.mineralRanges : requirement.requiredRanges;
    // coveredRanges 等价合并：直接复用 uncoveredParts（内部会合并覆盖段）
    const uncovered = uncoveredParts(targets, merged);
    return { uncovered };
  }, [requirement, segments, holeRecords]);

  const runSubmit = async () => {
    const values = await form.validateFields();
    if (segments.length === 0) {
      message.error('至少填写一段封孔段');
      return;
    }
    const bad = segments.map((s) => validateRange(Number(s.from), Number(s.to))).find(Boolean);
    if (bad) {
      message.error(`封孔段深度有误：${bad}`);
      return;
    }
    setSubmitting(true);
    try {
      const { verdict } = await submitRecord(
        {
          holeId,
          method: values.method,
          segments: segments.map((s) => ({ fromDepth: Number(s.from) || 0, toDepth: Number(s.to) || 0, cementTons: Number(s.cementTons) || 0 })),
          sealedAt: values.sealedAt.toISOString(),
          shift: values.shift,
          operator: values.operator,
          remark: values.remark,
        },
        requirement,
        forceFail,
      );
      message[verdict === 'rejected' ? 'warning' : 'success'](
        verdict === 'rejected'
          ? `提交成功但对账未过：保护矿化段没被封孔段盖住，本条已退回补封（水泥合计 ${cement.toFixed(2)}t）`
          : `班组封孔记录已提交，对账合格（水泥合计 ${cement.toFixed(2)}t）`,
      );
      onClose();
    } catch (error) {
      if (error instanceof CrewSubmitError) {
        setLastError(error.message);
        setAttempts((n) => n + 1);
        message.error('提交失败，表单内容已保留，请直接在本侧重试（编录室封孔要求未改动）');
      } else {
        throw error;
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (legacyRecord) {
    return (
      <Modal open={open} title="旧封孔记录（只读留证）" onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>} width={720}>
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="这是升级前终孔报告里的旧封孔记录，与新封孔分账各管各的数据不互通，只读展示，不能补封或改判。"
        />
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag>{legacyRecord.method}</Tag>
          <Tag>{legacyRecord.shift}</Tag>
          <Tag>水泥合计 {totalCement(legacyRecord)} t</Tag>
          <span style={{ color: '#6b7a86' }}>封孔日期 {new Date(legacyRecord.sealedAt).toLocaleDateString()} · {legacyRecord.operator}</span>
        </Space>
        <SpanEditor
          rows={legacyRecord.segments.map((s, i) => ({ key: `legacy-${i}`, from: s.fromDepth, to: s.toDepth, cementTons: s.cementTons }))}
          onChange={() => undefined}
          cement
          disabled
        />
        {legacyRecord.remark ? <Alert style={{ marginTop: 12 }} type="warning" showIcon message={legacyRecord.remark} /> : null}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={`封孔记录（钻探班组）`}
      onCancel={onClose}
      width={760}
      forceRender
      footer={[
        <Checkbox key="fail" checked={forceFail} onChange={(e) => setForceFail(e.target.checked)}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            模拟提交失败（演练按本侧重试）
          </Text>
        </Checkbox>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={runSubmit}>
          {attempts > 0 ? `按本侧重试（第 ${attempts + 1} 次提交）` : '提交封孔记录'}
        </Button>,
      ]}
    >
      {!requirement ? (
        <Alert style={{ marginBottom: 12 }} type="error" showIcon message="编录室尚未提出封孔要求（未终孔孔不接受封孔记录）。" />
      ) : (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message={
            <Space wrap size={4}>
              <span>对账依据：封孔要求 v{requirement.version}</span>
              <span style={{ color: '#6b7a86' }}>
                保护矿化段 {requirement.mineralRanges.map((r) => `${r.from}~${r.to}m`).join('、') || '（无矿化段，按要求封闭段整段）'}
              </span>
            </Space>
          }
        />
      )}
      {lastError ? <Alert style={{ marginBottom: 12 }} type="error" showIcon message={lastError} description="编录室那份封孔要求未被触碰；可直接修正后在本侧重试。" /> : null}

      <Form form={form} layout="vertical">
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="method" label="封孔方式" rules={[{ required: true }]}>
            <Select style={{ width: 170 }} options={SEAL_METHODS.map((m) => ({ label: m, value: m }))} />
          </Form.Item>
          <Form.Item name="sealedAt" label="封孔日期" rules={[{ required: true, message: '请选择封孔日期' }]}>
            <DatePicker style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="shift" label="施工班组" rules={[{ required: true }]}>
            <Select style={{ width: 120 }} options={SHIFTS.map((s) => ({ label: s, value: s }))} />
          </Form.Item>
          <Form.Item name="operator" label="班长/记录人" rules={[{ required: true, message: '请填写班长或记录人' }]}>
            <Input style={{ width: 150 }} maxLength={16} />
          </Form.Item>
        </Space>

        <Form.Item label="封孔起止深度与水泥用量" required>
          <SpanEditor rows={segments} onChange={setSegments} cement addText="新增封孔段" maxDepth={requirement?.finalDepth} />
        </Form.Item>

        {preview && requirement ? (
          preview.uncovered.length ? (
            <Alert
              type="error"
              showIcon
              message={`提交后将被退回补封：保护段 ${preview.uncovered.map((r) => `${r.from}~${r.to}m`).join('、')} 未被封孔段盖住`}
            />
          ) : (
            <Alert type="success" showIcon message="实时对账：保护矿化段均被封孔段盖住，提交后判合格" />
          )
        ) : null}

        <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={120} placeholder="封孔施工情况" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
