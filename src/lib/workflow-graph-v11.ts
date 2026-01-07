export type WorkflowGraphV11NodeType = "step" | "decision" | "merge" | "end" | "subworkflow";

export type WorkflowGraphV11Node = {
  id: string;
  type: WorkflowGraphV11NodeType;
  file: string;
  title?: string;
  description?: string;
  agentId?: string;
  inputs?: string[];
  outputs?: string[];
};

export type WorkflowGraphV11Edge = {
  id?: string;
  from: string;
  to: string;
  label: string;
  isDefault?: boolean;
  conditionText?: string;
  conditionExpr?: Record<string, unknown>;
};

export type WorkflowGraphV11 = {
  schemaVersion: "1.1";
  entryNodeId: string;
  nodes: WorkflowGraphV11Node[];
  edges: WorkflowGraphV11Edge[];
  metadata?: Record<string, unknown>;
};

export type BuilderGraphNode = {
  id: string;
  type?: unknown;
  data?: {
    title?: unknown;
    agentId?: unknown;
    inputs?: unknown;
    outputs?: unknown;
    instructions?: unknown;
  };
};

export type BuilderGraphEdge = {
  id?: string;
  source: string;
  target: string;
  label?: unknown;
  data?: {
    isDefault?: unknown;
    conditionText?: unknown;
  };
};

export type WorkflowGraphBuildResult = {
  graph: WorkflowGraphV11 | null;
  warnings: string[];
  errors: string[];
};

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isNodeType(value: unknown): value is WorkflowGraphV11NodeType {
  return value === "step" || value === "decision" || value === "merge" || value === "end" || value === "subworkflow";
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v): v is string => Boolean(v));
  return cleaned.length ? cleaned : [];
}

function stableEdgeSortKey(edge: BuilderGraphEdge, fallbackIndex: number): string {
  const id = typeof edge.id === "string" ? edge.id.trim() : "";
  if (id) return id;
  const source = edge.source ?? "";
  const target = edge.target ?? "";
  return `${source}->${target}#${fallbackIndex}`;
}

export function buildWorkflowGraphV11(params: {
  nodes: BuilderGraphNode[];
  edges: BuilderGraphEdge[];
}): WorkflowGraphBuildResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const nodes = Array.isArray(params.nodes) ? params.nodes : [];
  const edges = Array.isArray(params.edges) ? params.edges : [];

  if (!nodes.length) {
    return { graph: null, warnings, errors: ["Failed to generate workflow.graph.json: graph has no nodes (nodes is empty)."] };
  }

  const nodesById = new Map<string, BuilderGraphNode>();
  for (const node of nodes) {
    if (!node?.id) continue;
    nodesById.set(node.id, node);
  }

  const nodeIds = Array.from(nodesById.keys());
  const duplicates = nodes.length - nodeIds.length;
  if (duplicates > 0) {
    warnings.push(`Detected duplicate nodeId(s) (last occurrence wins): ${duplicates}.`);
  }

  const invalidIds = nodeIds.filter((id) => !NODE_ID_PATTERN.test(id));
  if (invalidIds.length) {
    errors.push(`Invalid nodeId(s): ${invalidIds.join(", ")}`);
  }

  const validEdges: Array<{ edge: BuilderGraphEdge; idx: number }> = [];
  edges.forEach((edge, idx) => {
    if (!edge?.source || !edge?.target) {
      errors.push(`Incomplete edge (missing source/target): index=${idx}`);
      return;
    }
    if (!nodesById.has(edge.source)) {
      errors.push(`edge.source not found: ${edge.source} (index=${idx})`);
      return;
    }
    if (!nodesById.has(edge.target)) {
      errors.push(`edge.target not found: ${edge.target} (index=${idx})`);
      return;
    }
    validEdges.push({ edge, idx });
  });

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  nodeIds.forEach((id) => {
    indegree.set(id, 0);
    outgoing.set(id, []);
  });

  validEdges.forEach(({ edge }) => {
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  });

  if (validEdges.length) {
    const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
    const nextIndegree = new Map(indegree);
    let visited = 0;

    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      visited += 1;
      for (const to of outgoing.get(id) ?? []) {
        const value = (nextIndegree.get(to) ?? 0) - 1;
        nextIndegree.set(to, value);
        if (value === 0) queue.push(to);
      }
    }

    if (visited !== nodeIds.length) {
      errors.push("Cycle detected: remove cyclic edges before generating workflow.graph.json.");
    }
  }

  const startNodes = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort((a, b) => a.localeCompare(b));
  const entryNodeId = (() => {
    if (startNodes.length === 1) return startNodes[0] ?? "";
    if (startNodes.length > 1) {
      warnings.push(`Multiple entry nodes detected: chose entryNodeId=${startNodes[0]}`);
      return startNodes[0] ?? "";
    }
    return "";
  })();

  if (!entryNodeId) {
    errors.push("Unable to determine entryNodeId: no start node with indegree 0 found.");
  }

  if (errors.length) return { graph: null, warnings, errors };

  const mappedNodes: WorkflowGraphV11Node[] = nodeIds
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const node = nodesById.get(id);
      const rawType = node?.type;
      const type: WorkflowGraphV11NodeType = isNodeType(rawType) ? rawType : "step";
      if (rawType && !isNodeType(rawType)) warnings.push(`Unknown node.type (fallback to step): ${id}:${String(rawType)}`);

      const titleRaw = node?.data?.title;
      const title = typeof titleRaw === "string" ? titleRaw.trim() : "";

      const agentIdRaw = node?.data?.agentId;
      const agentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";

      const inputs = parseStringList(node?.data?.inputs);
      const outputs = parseStringList(node?.data?.outputs);

      return {
        id,
        type,
        file: `steps/${id}.md`,
        ...(title ? { title } : {}),
        ...(agentId ? { agentId } : {}),
        ...(inputs.length ? { inputs } : {}),
        ...(outputs.length ? { outputs } : {}),
      };
    });

  const edgesBySource = new Map<string, Array<{ edge: BuilderGraphEdge; idx: number }>>();
  validEdges.forEach((record) => {
    const bucket = edgesBySource.get(record.edge.source) ?? [];
    bucket.push(record);
    edgesBySource.set(record.edge.source, bucket);
  });

  const mappedEdges: WorkflowGraphV11Edge[] = [];
  const sources = Array.from(edgesBySource.keys()).sort((a, b) => a.localeCompare(b));
  sources.forEach((source) => {
    const group = (edgesBySource.get(source) ?? [])
      .slice()
      .sort((a, b) => stableEdgeSortKey(a.edge, a.idx).localeCompare(stableEdgeSortKey(b.edge, b.idx)));

    const multi = group.length > 1;
    const defaults = group.filter(({ edge }) => edge?.data?.isDefault === true);
    const chosenDefault = multi ? (defaults[0] ?? group[0]) : null;
    if (multi && defaults.length > 1) {
      const ids = defaults.map((d) => (typeof d.edge.id === "string" ? d.edge.id : stableEdgeSortKey(d.edge, d.idx)));
      warnings.push(`Multiple default edges for the same node (kept the first): ${source} -> ${ids.join(", ")}`);
    }

    group.forEach(({ edge }, idx) => {
      const rawLabel = typeof edge.label === "string" ? edge.label.trim() : "";
      const label = rawLabel || (multi ? `branch-${idx + 1}` : "next");

      const conditionTextRaw = edge.data?.conditionText;
      const conditionText = typeof conditionTextRaw === "string" ? conditionTextRaw.trim() : "";

      const id = typeof edge.id === "string" && edge.id.trim() ? edge.id.trim() : undefined;
      const isDefault = Boolean(chosenDefault && chosenDefault.edge === edge);

      mappedEdges.push({
        ...(id ? { id } : {}),
        from: edge.source,
        to: edge.target,
        label,
        ...(multi && isDefault ? { isDefault: true } : {}),
        ...(conditionText ? { conditionText } : {}),
      });
    });
  });

  return {
    graph: {
      schemaVersion: "1.1",
      entryNodeId,
      nodes: mappedNodes,
      edges: mappedEdges,
    },
    warnings,
    errors,
  };
}
