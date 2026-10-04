import { Button, InputNumber, Space, Table, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import { useMemo } from 'react';

const { Text } = Typography;

export interface EditableSpan {
  key: string;
  from: number;
  to: number;
  /** 封孔段专用：本段水泥用量（t）；矿化段/要求段编辑时为空 */
  cementTons?: number;
}

interface SpanEditorProps {
  rows: EditableSpan[];
  onChange: (rows: EditableSpan[]) => void;
  /** 是否显示水泥用量列（班组封孔段） */
  cement?: boolean;
  /** 只读（旧留证等） */
  disabled?: boolean;
  addText?: string;
  maxDepth?: number;
}

let spanSeq = 0;
export function newSpanKey(): string {
  spanSeq += 1;
  return `span-new-${Date.now()}-${spanSeq}`;
}

/** 深度段行内编辑表：矿化段 / 要求封闭段 / 班组封孔段共用 */
export default function SpanEditor({ rows, onChange, cement = false, disabled = false, addText = '新增一段', maxDepth }: SpanEditorProps) {
  const patch = (key: string, part: Partial<EditableSpan>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...part } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));

  const totalLength = useMemo(() => rows.reduce((sum, r) => sum + Math.max(0, (Number(r.to) || 0) - (Number(r.from) || 0)), 0), [rows]);
  const totalCement = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.cementTons) || 0), 0), [rows]);

  const columns: TableColumnsType<EditableSpan> = [
    {
      title: '起深度(m)',
      width: 150,
      render: (_, row) => <InputNumber min={0} step={0.5} value={row.from} disabled={disabled} style={{ width: 120 }} onChange={(v) => patch(row.key, { from: Number(v) || 0 })} />,
    },
    {
      title: '止深度(m)',
      width: 150,
      render: (_, row) => (
        <InputNumber
          min={0}
          step={0.5}
          value={row.to}
          disabled={disabled}
          style={{ width: 120 }}
          status={maxDepth && row.to > maxDepth ? 'error' : undefined}
          onChange={(v) => patch(row.key, { to: Number(v) || 0 })}
        />
      ),
    },
    {
      title: '段长(m)',
      width: 100,
      align: 'right',
      render: (_, row) => <Text type="secondary">{Math.max(0, Number(((Number(row.to) || 0) - (Number(row.from) || 0)).toFixed(2)))}</Text>,
    },
  ];
  if (cement) {
    columns.push({
      title: '水泥用量(t)',
      width: 150,
      render: (_, row) => <InputNumber min={0} step={0.1} value={row.cementTons} disabled={disabled} style={{ width: 120 }} onChange={(v) => patch(row.key, { cementTons: Number(v) || 0 })} />,
    });
  }
  if (!disabled) {
    columns.push({
      title: '操作',
      width: 80,
      render: (_, row) => (
        <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => remove(row.key)}>
          删除
        </Button>
      ),
    });
  }

  return (
    <div>
      <Table
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: cement ? 560 : 460 }}
        locale={{ emptyText: <Text type="secondary">暂无深度段</Text> }}
      />
      {!disabled ? (
        <Space style={{ marginTop: 8 }}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...rows, { key: newSpanKey(), from: 0, to: 0, ...(cement ? { cementTons: 0 } : {}) }])}>
            {addText}
          </Button>
          <Text type="secondary">合计段长 {totalLength.toFixed(2)} m</Text>
          {cement ? <Text type="secondary">水泥合计 {totalCement.toFixed(2)} t</Text> : null}
        </Space>
      ) : null}
    </div>
  );
}
