// The twenty agents of the mock scenario and the tasks they cycle through.
// Pure data, shared by the mock source (server) and any test.
import { EXECUTIVE_DEPARTMENT } from './seating';

export interface RosterAgent {
  agentId: string;
  agentRole: string;
  department: string;
  /** Every task with this index modulo `deliverEvery` ends with a delivery. */
  deliverEvery: number;
  deliverTo: 'output' | 'manager';
}

export const ROSTER: RosterAgent[] = [
  { agentId: 'agent-senior-dev', agentRole: 'Software Architect', department: 'Engineering Bay', deliverEvery: 2, deliverTo: 'output' },
  { agentId: 'agent-backend-1', agentRole: 'Backend Engineer', department: 'Engineering Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-backend-2', agentRole: 'Backend Engineer', department: 'Engineering Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-frontend', agentRole: 'Frontend Engineer', department: 'Engineering Bay', deliverEvery: 2, deliverTo: 'manager' },
  { agentId: 'agent-devops', agentRole: 'Platform Engineer', department: 'Engineering Bay', deliverEvery: 4, deliverTo: 'output' },
  { agentId: 'agent-researcher', agentRole: 'Research Lead', department: 'Research Bay', deliverEvery: 2, deliverTo: 'output' },
  { agentId: 'agent-analyst-1', agentRole: 'Data Analyst', department: 'Research Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-analyst-2', agentRole: 'Data Analyst', department: 'Research Bay', deliverEvery: 3, deliverTo: 'manager' },
  { agentId: 'agent-librarian', agentRole: 'Knowledge Curator', department: 'Research Bay', deliverEvery: 4, deliverTo: 'output' },
  { agentId: 'agent-forecaster', agentRole: 'Quant Modeller', department: 'Research Bay', deliverEvery: 2, deliverTo: 'output' },
  { agentId: 'agent-writer', agentRole: 'Technical Writer', department: 'Creative Bay', deliverEvery: 2, deliverTo: 'output' },
  { agentId: 'agent-designer', agentRole: 'Product Designer', department: 'Creative Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-copy', agentRole: 'Copywriter', department: 'Creative Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-illustrator', agentRole: 'Illustrator', department: 'Creative Bay', deliverEvery: 4, deliverTo: 'output' },
  { agentId: 'agent-video', agentRole: 'Motion Designer', department: 'Creative Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-qa-lead', agentRole: 'QA Lead', department: 'QA Bay', deliverEvery: 2, deliverTo: 'manager' },
  { agentId: 'agent-qa-1', agentRole: 'Test Engineer', department: 'QA Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-qa-2', agentRole: 'Test Engineer', department: 'QA Bay', deliverEvery: 3, deliverTo: 'output' },
  { agentId: 'agent-security', agentRole: 'Security Reviewer', department: 'QA Bay', deliverEvery: 2, deliverTo: 'output' },
  { agentId: 'agent-orchestrator', agentRole: 'Orchestrator', department: EXECUTIVE_DEPARTMENT, deliverEvery: 1000, deliverTo: 'output' },
];

export interface TaskTemplate {
  title: string;
  subtasks: string[];
}

export const TASKS_BY_DEPARTMENT: Record<string, TaskTemplate[]> = {
  'Engineering Bay': [
    { title: 'Refactoring Auth Middleware', subtasks: ['Reading current middleware', 'Extracting JWT parser', 'Running unit tests on JWT token parser', 'Updating call sites', 'Writing migration notes'] },
    { title: 'Rate limiter for public API', subtasks: ['Sketching token-bucket design', 'Implementing bucket store', 'Load-testing at 5k rps', 'Documenting limits'] },
    { title: 'Flaky integration test triage', subtasks: ['Reproducing failure locally', 'Bisecting recent commits', 'Isolating shared fixture', 'Patching test setup'] },
    { title: 'Schema migration: orders table', subtasks: ['Drafting migration', 'Backfilling in batches', 'Verifying row counts', 'Dropping old column'] },
    { title: 'Deploy pipeline hardening', subtasks: ['Pinning base images', 'Adding SBOM step', 'Rotating deploy keys', 'Dry-run on staging'] },
  ],
  'Research Bay': [
    { title: 'Literature scan: retrieval eval', subtasks: ['Collecting candidate papers', 'Skimming abstracts', 'Extracting benchmark tables', 'Ranking by relevance'] },
    { title: 'Churn cohort analysis', subtasks: ['Pulling cohort data', 'Cleaning nulls', 'Fitting survival curves', 'Summarising findings'] },
    { title: 'Forecast Q4 token spend', subtasks: ['Aggregating usage logs', 'Fitting seasonal model', 'Running scenarios', 'Writing assumptions'] },
    { title: 'Knowledge base dedupe', subtasks: ['Embedding documents', 'Clustering near-duplicates', 'Reviewing merge candidates', 'Applying merges'] },
  ],
  'Creative Bay': [
    { title: 'Onboarding guide rewrite', subtasks: ['Auditing current guide', 'Drafting new outline', 'Writing sections 1-3', 'Editing for tone'] },
    { title: 'Dashboard empty states', subtasks: ['Listing empty states', 'Sketching layouts', 'Writing copy', 'Exporting assets'] },
    { title: 'Launch announcement copy', subtasks: ['Reading product brief', 'Drafting headline options', 'Writing body copy', 'Trimming to length'] },
    { title: 'Icon set refresh', subtasks: ['Inventorying icons', 'Redrawing at 24px', 'Checking contrast', 'Packaging sprite'] },
    { title: 'Release trailer storyboard', subtasks: ['Outlining beats', 'Framing key shots', 'Timing to music', 'Exporting boards'] },
  ],
  'QA Bay': [
    { title: 'Regression suite for checkout', subtasks: ['Mapping checkout flows', 'Writing happy-path tests', 'Adding edge cases', 'Running full suite'] },
    { title: 'Accessibility audit', subtasks: ['Keyboard traversal', 'Screen-reader labels', 'Contrast checks', 'Filing findings'] },
    { title: 'Security review: auth flow', subtasks: ['Threat modelling', 'Testing token replay', 'Checking session expiry', 'Writing report'] },
    { title: 'Release gate checklist', subtasks: ['Collecting test results', 'Verifying rollback plan', 'Signing off blockers', 'Publishing go/no-go'] },
  ],
  [EXECUTIVE_DEPARTMENT]: [
    { title: 'Delegating sprint work', subtasks: ['Reading backlog', 'Assigning tasks to agents', 'Reviewing progress reports', 'Rebalancing load'] },
    { title: 'Weekly synthesis', subtasks: ['Collecting deliveries', 'Summarising outcomes', 'Flagging risks', 'Publishing digest'] },
  ],
};

/** Small deterministic PRNG so the mock is reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
