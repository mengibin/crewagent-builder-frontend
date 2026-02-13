"use client";

import { useParams } from "next/navigation";

import { AgentEditorPage } from "@/components/builder/agent-editor-page";

export default function NewAgentPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? "";
  return <AgentEditorPage projectId={projectId} mode="new" />;
}
