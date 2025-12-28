import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import agentsSchemaV11 from "../bmad-spec/v1.1/agents.schema.json";
import bmadSchemaV11 from "../bmad-spec/v1.1/bmad.schema.json";
import stepFrontmatterSchemaV11 from "../bmad-spec/v1.1/step-frontmatter.schema.json";
import workflowFrontmatterSchemaV11 from "../bmad-spec/v1.1/workflow-frontmatter.schema.json";
import workflowGraphSchemaV11 from "../bmad-spec/v1.1/workflow-graph.schema.json";

export type AjvValidateFn = ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };

let ajvInstance: Ajv2020 | null = null;
let validateBmad: AjvValidateFn | null = null;
let validateAgents: AjvValidateFn | null = null;
let validateWorkflowGraph: AjvValidateFn | null = null;
let validateWorkflowFrontmatter: AjvValidateFn | null = null;
let validateStepFrontmatter: AjvValidateFn | null = null;

function getAjvV11(): Ajv2020 {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajvInstance = ajv;
  return ajv;
}

export function getBmadSchemaValidatorV11(): AjvValidateFn {
  if (validateBmad) return validateBmad;
  const ajv = getAjvV11();
  validateBmad = ajv.compile(bmadSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateBmad;
}

export function getAgentsSchemaValidatorV11(): AjvValidateFn {
  if (validateAgents) return validateAgents;
  const ajv = getAjvV11();
  validateAgents = ajv.compile(agentsSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateAgents;
}

export function getWorkflowGraphSchemaValidatorV11(): AjvValidateFn {
  if (validateWorkflowGraph) return validateWorkflowGraph;
  const ajv = getAjvV11();
  validateWorkflowGraph = ajv.compile(workflowGraphSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateWorkflowGraph;
}

export function getWorkflowFrontmatterSchemaValidatorV11(): AjvValidateFn {
  if (validateWorkflowFrontmatter) return validateWorkflowFrontmatter;
  const ajv = getAjvV11();
  validateWorkflowFrontmatter = ajv.compile(workflowFrontmatterSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateWorkflowFrontmatter;
}

export function getStepFrontmatterSchemaValidatorV11(): AjvValidateFn {
  if (validateStepFrontmatter) return validateStepFrontmatter;
  const ajv = getAjvV11();
  validateStepFrontmatter = ajv.compile(stepFrontmatterSchemaV11 as unknown as Record<string, unknown>) as AjvValidateFn;
  return validateStepFrontmatter;
}

