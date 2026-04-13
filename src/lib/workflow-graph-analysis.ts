export type WorkflowGraphAnalysisNode = {
  id: string;
  type?: unknown;
};

export type WorkflowGraphAnalysisEdge = {
  from: string;
  to: string;
};

export type WorkflowGraphCycleIssueCode = "cycle-missing-decision" | "cycle-missing-exit";

export type WorkflowGraphCycleIssue = {
  code: WorkflowGraphCycleIssueCode;
  nodeIds: string[];
  message: string;
};

export type WorkflowGraphAnalysisResult = {
  nodeIds: string[];
  startNodeIds: string[];
  entryNodeId: string;
  orderedNodeIds: string[];
  cycleIssues: WorkflowGraphCycleIssue[];
};

function isDecisionNodeType(value: unknown): boolean {
  return value === "decision";
}

function formatCycleNodeIds(nodeIds: string[]): string {
  return nodeIds.join(", ");
}

export function analyzeWorkflowGraph(params: {
  nodes: WorkflowGraphAnalysisNode[];
  edges: WorkflowGraphAnalysisEdge[];
}): WorkflowGraphAnalysisResult {
  const nodeIds: string[] = [];
  const nodeTypes = new Map<string, unknown>();
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of params.nodes) {
    if (!node?.id || nodeTypes.has(node.id)) continue;
    nodeIds.push(node.id);
    nodeTypes.set(node.id, node.type);
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  const validEdges: WorkflowGraphAnalysisEdge[] = [];
  for (const edge of params.edges) {
    if (!edge?.from || !edge?.to) continue;
    if (!nodeTypes.has(edge.from) || !nodeTypes.has(edge.to)) continue;
    validEdges.push(edge);
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const startNodeIds = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);

  const indexByNodeId = new Map<string, number>();
  const lowLinkByNodeId = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  function strongConnect(nodeId: string) {
    indexByNodeId.set(nodeId, index);
    lowLinkByNodeId.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const nextNodeId of outgoing.get(nodeId) ?? []) {
      if (!indexByNodeId.has(nextNodeId)) {
        strongConnect(nextNodeId);
        lowLinkByNodeId.set(
          nodeId,
          Math.min(lowLinkByNodeId.get(nodeId) ?? 0, lowLinkByNodeId.get(nextNodeId) ?? 0),
        );
      } else if (onStack.has(nextNodeId)) {
        lowLinkByNodeId.set(
          nodeId,
          Math.min(lowLinkByNodeId.get(nodeId) ?? 0, indexByNodeId.get(nextNodeId) ?? 0),
        );
      }
    }

    if ((lowLinkByNodeId.get(nodeId) ?? -1) !== (indexByNodeId.get(nodeId) ?? -2)) return;

    const component: string[] = [];
    while (stack.length) {
      const currentNodeId = stack.pop();
      if (!currentNodeId) break;
      onStack.delete(currentNodeId);
      component.push(currentNodeId);
      if (currentNodeId === nodeId) break;
    }
    components.push(component);
  }

  for (const nodeId of nodeIds) {
    if (!indexByNodeId.has(nodeId)) strongConnect(nodeId);
  }

  const cycleIssues: WorkflowGraphCycleIssue[] = [];
  for (const component of components) {
    const componentSet = new Set(component);
    const hasSelfLoop = component.some((nodeId) => (outgoing.get(nodeId) ?? []).includes(nodeId));
    const isCycle = component.length > 1 || hasSelfLoop;
    if (!isCycle) continue;

    const componentNodeIds = component
      .slice()
      .sort((left, right) => left.localeCompare(right));
    const hasDecision = component.some((nodeId) => isDecisionNodeType(nodeTypes.get(nodeId)));
    const hasExit = validEdges.some((edge) => componentSet.has(edge.from) && !componentSet.has(edge.to));

    if (!hasDecision) {
      cycleIssues.push({
        code: "cycle-missing-decision",
        nodeIds: componentNodeIds,
        message: `Cycle detected for nodes ${formatCycleNodeIds(componentNodeIds)}: add a decision node to control the loop.`,
      });
    }

    if (!hasExit) {
      cycleIssues.push({
        code: "cycle-missing-exit",
        nodeIds: componentNodeIds,
        message: `Cycle detected for nodes ${formatCycleNodeIds(componentNodeIds)}: add an edge that exits the loop.`,
      });
    }
  }

  const entryNodeId = (() => {
    if (startNodeIds.length > 0) return startNodeIds[0] ?? "";
    if (cycleIssues.length > 0) return "";
    for (const nodeId of nodeIds) {
      if (isDecisionNodeType(nodeTypes.get(nodeId))) return nodeId;
    }
    return nodeIds[0] ?? "";
  })();

  const orderedNodeIds: string[] = [];
  const visited = new Set<string>();
  const queue = entryNodeId ? [entryNodeId] : startNodeIds.slice();

  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    orderedNodeIds.push(nodeId);
    for (const nextNodeId of outgoing.get(nodeId) ?? []) {
      if (!visited.has(nextNodeId)) queue.push(nextNodeId);
    }
  }

  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) continue;
    orderedNodeIds.push(nodeId);
  }

  return {
    nodeIds,
    startNodeIds,
    entryNodeId,
    orderedNodeIds,
    cycleIssues,
  };
}
