"use client";

import { useParams } from "next/navigation";

import { AgentEditorPage } from "@/components/builder/agent-editor-page";

export default function EditAgentPage() {
  const params = useParams<{ projectId: string; agentId: string }>();
  const projectId = params?.projectId ?? "";
  const agentId = params?.agentId ?? "";
  return <AgentEditorPage projectId={projectId} mode="edit" agentId={agentId} />;
}
