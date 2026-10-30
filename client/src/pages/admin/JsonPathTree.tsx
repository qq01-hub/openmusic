import { memo, useMemo, useState } from 'react';
import { CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button, Tag, Typography } from 'antd';

interface JsonPathTreeProps {
  /** 相对于此值的路径会被 onPick 回传（例如传入 items[0] 子对象时回传字段相对路径） */
  value: unknown;
  onPick: (path: string) => void;
  /** 只允许选择数组/对象（用于选“结果列表”节点） */
  containerOnly?: boolean;
  /** 当前已选中的相对路径，用于高亮 */
  activePath?: string;
}

const NODE_PAGE_SIZE = 40;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function previewScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const text = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    return `"${text}"`;
  }
  return String(value);
}

function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (!parent) return key;
  return `${parent}.${key}`;
}

interface NodeProps extends Omit<JsonPathTreeProps, 'value'> {
  label: string;
  nodeValue: unknown;
  path: string;
  depth: number;
}

const TreeNode = memo(function TreeNode({ label, nodeValue, path, depth, onPick, containerOnly, activePath }: NodeProps) {
  const [open, setOpen] = useState(depth < 2);
  const [page, setPage] = useState(0);
  const container = isContainer(nodeValue);
  const selectable = container ? containerOnly !== false : !containerOnly;
  const isActive = Boolean(path) && path === activePath;

  const objectKeys = useMemo(() => (
    isContainer(nodeValue) && !Array.isArray(nodeValue) ? Object.keys(nodeValue) : []
  ), [nodeValue]);
  const count = Array.isArray(nodeValue) ? nodeValue.length : objectKeys.length;
  const totalPages = Math.max(1, Math.ceil(count / NODE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * NODE_PAGE_SIZE;
  const entries: Array<readonly [string | number, unknown]> = !container || !open ? []
    : Array.from({ length: Math.min(NODE_PAGE_SIZE, count - start) }, (_, offset) => {
      const index = start + offset;
      return Array.isArray(nodeValue)
        ? [index, nodeValue[index]] as const
        : [objectKeys[index], nodeValue[objectKeys[index]]] as const;
    });

  const typeHint = container
    ? (Array.isArray(nodeValue) ? `数组 · ${count} 项` : `对象 · ${count} 字段`)
    : '';

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 4px',
          borderRadius: 4,
          background: isActive ? '#e6f4ff' : 'transparent',
        }}
      >
        {container ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#8c8c8c' }}
            aria-label={open ? '收起' : '展开'}
          >
            {open ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </button>
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{label}</Typography.Text>
        {container ? (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{typeHint}</Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace', color: '#1677ff' }}>
            {previewScalar(nodeValue)}
          </Typography.Text>
        )}
        {isActive && <Tag color="processing" style={{ marginInlineStart: 4 }}>已选</Tag>}
        {selectable && path && (
          <Button
            size="small"
            type={isActive ? 'primary' : 'link'}
            style={{ padding: '0 6px', height: 20, fontSize: 12 }}
            onClick={() => onPick(path)}
          >
            选这个
          </Button>
        )}
      </div>
      {container && open && entries.map(([key, child]) => (
        <TreeNode
          key={String(key)}
          label={typeof key === 'number' ? `[${key}]` : key}
          nodeValue={child}
          path={joinPath(path, key)}
          depth={depth + 1}
          onPick={onPick}
          containerOnly={containerOnly}
          activePath={activePath}
        />
      ))}
      {container && open && totalPages > 1 && (
        <div style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 8, padding: 4 }}>
          <Button size="small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {start + 1}–{Math.min(start + NODE_PAGE_SIZE, count)} / {count}
          </Typography.Text>
          <Button size="small" disabled={currentPage === totalPages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button>
        </div>
      )}
    </div>
  );
});

export default function JsonPathTree({ value, onPick, containerOnly, activePath }: JsonPathTreeProps) {
  return (
    <div
      style={{
        maxHeight: 320,
        overflow: 'auto',
        padding: 10,
        borderRadius: 6,
        border: '1px solid #e5e7eb',
        background: '#fff',
      }}
    >
      <TreeNode
        label="根"
        nodeValue={value}
        path=""
        depth={0}
        onPick={onPick}
        containerOnly={containerOnly}
        activePath={activePath}
      />
    </div>
  );
}
