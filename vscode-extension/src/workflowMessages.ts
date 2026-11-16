import { WorkflowKind } from "./requestBuilder";

export function buildWorkflowPassMessage(params: {
  kind: WorkflowKind;
  target: string;
  requestId: string;
  operation: string;
  artifactPath?: string;
}): string {
  const action = params.kind === "run" ? "run" : "validate";
  if (params.artifactPath) {
    return `OS4TB ${action} PASS (target=${params.target}, request_id=${params.requestId}, operation=${params.operation}, artifact_path=${params.artifactPath}).`;
  }
  return `OS4TB ${action} PASS (target=${params.target}, request_id=${params.requestId}, operation=${params.operation}).`;
}

export function buildWorkflowFailMessage(params: {
  kind: WorkflowKind;
  target: string;
  requestId: string;
  reason: string;
  exitCode: string;
}): string {
  const action = params.kind === "run" ? "run" : "validate";
  return `OS4TB ${action} FAIL (target=${params.target}, request_id=${params.requestId}, reason=${params.reason}, exit=${params.exitCode}).`;
}
