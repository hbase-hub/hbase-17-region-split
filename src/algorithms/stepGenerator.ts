/**
 * Region 分裂 — 步骤生成器
 *
 * 动画展示 HBase Region Split 流程：
 * Region 达到阈值触发 split；计算 splitKey；创建两个子 region（含父 meta）；
 * RegionServer 执行 split，ZK 通知 HMaster；旧 region 下线，两个新 region 上线；
 * split 期间该 region 短暂不可用。
 */
import type { Step, VisualElement, VariableState } from '../types'

/** Region Split 伪代码 */
export const TEMPLATE_CODE = `// RegionServer 执行 Region 分裂
public void splitRegion(Region region) {
    // 1. 达到阈值(默认 256MB)触发分裂
    if (region.getMemStoreFlushSize() > THRESHOLD) {
        // 2. 计算 splitKey（按最大行分割）
        long splitKey = region.getSplitPoint();
        // 3. 创建两个子 region，继承父 region meta
        RegionInfo a = region.splitBefore(splitKey);
        RegionInfo b = region.splitAfter(splitKey);
        // 4. RS 执行 split，ZK 通知 HMaster
        zkw.reportState(region, SPLITTING);
        // 5. 父 region 下线，两个子 region 上线
        master.assign(a);
        master.assign(b);
    }
}`

// 画布布局常量
const LAYOUT = {
  rs: { x: 60, y: 40, w: 880, h: 100, label: 'RegionServer' },
  parent: { x: 250, y: 60, w: 500, h: 60, label: 'Region (父, 256MB)' },
  zk: { x: 380, y: 180, w: 240, h: 50, label: 'ZooKeeper' },
  master: { x: 60, y: 180, w: 260, h: 50, label: 'HMaster' },
  childA: { x: 150, y: 300, w: 250, h: 60, label: 'Region A' },
  childB: { x: 550, y: 300, w: 250, h: 60, label: 'Region B' },
  splitKey: { x: 480, y: 65, w: 40, h: 50, label: 'splitKey' },
}

function makeElements(highlight?: string, extra?: Record<string, string>): VisualElement[] {
  const mk = (
    key: keyof typeof LAYOUT,
    type: string,
    state: string
  ): VisualElement => {
    const l = LAYOUT[key]
    return {
      id: key,
      type,
      label: l.label,
      x: l.x,
      y: l.y,
      width: l.w,
      height: l.h,
      state: key === highlight ? 'active' : (extra?.[key] ?? state),
    }
  }
  return [
    mk('rs', 'rs', 'idle'),
    mk('parent', 'region', 'idle'),
    mk('zk', 'zk', 'idle'),
    mk('master', 'master', 'idle'),
    mk('childA', 'region', 'idle'),
    mk('childB', 'region', 'idle'),
    mk('splitKey', 'split', 'idle'),
  ]
}

export function generateSteps(): Step[] {
  const steps: Step[] = []
  let idx = 0

  const push = (
    desc: string,
    line: number,
    vars: VariableState[],
    elements: VisualElement[],
    arrows: { from: string; to: string; label?: string }[] = [],
    actionLabel?: string,
    statusText?: string
  ) => {
    steps.push({
      index: idx++,
      description: desc,
      currentLine: line,
      variables: vars,
      elements,
      connections: arrows.map((a, i) => ({
        id: `arrow-${i}`,
        fromId: a.from,
        toId: a.to,
        kind: 'arrow' as const,
        label: a.label,
      })),
      annotations: [],
      actionLabel,
      statusText: statusText ?? desc,
    })
  }

  // 步骤 0：分裂拓扑
  push(
    'Region 分裂：单个大 Region 按行键分裂为两个子 Region，由 RegionServer 执行、ZK 通知 HMaster',
    0,
    [],
    makeElements(),
    [
      { from: 'rs', to: 'parent', label: '托管' },
      { from: 'rs', to: 'zk', label: '通知' },
      { from: 'zk', to: 'master', label: 'watch' },
    ],
    'OVERVIEW',
    'Region 分裂拓扑'
  )

  // 步骤 1：达到阈值触发
  push(
    'Region 数据量达到阈值（默认 256MB）触发 split 判定',
    4,
    [
      { name: 'regionSize', value: '256MB', line: 4, type: 'long' },
      { name: 'THRESHOLD', value: '256MB', line: 4 },
    ],
    makeElements('parent'),
    [],
    'TRIGGER',
    '达到 256MB 触发'
  )

  // 步骤 2：计算 splitKey
  push(
    '计算 splitKey：取 Region 中间行键作为分裂点，保证两个子 region 数据均匀',
    6,
    [
      { name: 'splitKey', value: 'row1000', line: 6, type: 'byte[]' },
      { name: 'regionSize', value: '256MB', line: 4 },
    ],
    makeElements('splitKey'),
    [{ from: 'parent', to: 'splitKey', label: '2.getSplitPoint' }],
    'SPLITKEY',
    '计算 splitKey=row1000'
  )

  // 步骤 3：创建两个子 region
  push(
    '创建两个子 region A、B，继承父 region 的表/列族 meta，按 splitKey 划分行键范围',
    8,
    [
      { name: 'children', value: "['A','B']", line: 8, type: 'String[]' },
      { name: 'A', value: 'startKey..row1000', line: 8, type: 'RegionInfo' },
      { name: 'B', value: 'row1000..endKey', line: 9, type: 'RegionInfo' },
    ],
    makeElements('parent'),
    [
      { from: 'parent', to: 'childA', label: '3.splitBefore' },
      { from: 'parent', to: 'childB', label: '3.splitAfter' },
    ],
    'CREATE',
    '创建子 region A/B'
  )

  // 步骤 4：RS 执行 split，通知 ZK
  push(
    'RegionServer 执行 split：父 region 进入 SPLITTING，向 ZK 上报状态',
    11,
    [
      { name: 'parent', value: 'SPLITTING', line: 11, type: 'RegionState' },
      { name: 'children', value: "['A','B']", line: 8 },
    ],
    makeElements('rs', { parent: 'active' }),
    [
      { from: 'rs', to: 'zk', label: '4.reportState SPLITTING' },
      { from: 'zk', to: 'master', label: 'notify' },
    ],
    'SPLITTING',
    '执行 split，SPLITTING'
  )

  // 步骤 5：split 期间短暂不可用
  push(
    'split 期间该 region 短暂不可用：写请求重试或路由到 meta，通常 <1s',
    11,
    [
      { name: 'availability', value: '短暂不可用 (<1s)', line: 11 },
      { name: 'parent', value: 'SPLITTING', line: 11 },
    ],
    makeElements('parent', { parent: 'active' }),
    [],
    'UNAVAILABLE',
    'split 期间不可用'
  )

  // 步骤 6：父 region 下线
  push(
    '父 region 完成 split 后下线，状态转为 OFFLINE/CLOSED，不再接收请求',
    14,
    [
      { name: 'parent', value: 'OFFLINE', line: 14, type: 'RegionState' },
      { name: 'children', value: "['A','B']", line: 8 },
    ],
    makeElements('parent', { parent: 'deleted' }),
    [],
    'OFFLINE',
    '父 region 下线 OFFLINE'
  )

  // 步骤 7：两个子 region 上线
  push(
    'HMaster 分配两个子 region，状态转为 OPEN，分别托管不同行键范围',
    14,
    [
      { name: 'children', value: "['A','B']", line: 14, type: 'String[]' },
      { name: 'A.state', value: 'OPEN', line: 15 },
      { name: 'B.state', value: 'OPEN', line: 16 },
    ],
    makeElements('master'),
    [
      { from: 'master', to: 'childA', label: '5.assign A' },
      { from: 'master', to: 'childB', label: '5.assign B' },
    ],
    'DONE',
    '子 region 上线 OPEN'
  )

  return steps
}
