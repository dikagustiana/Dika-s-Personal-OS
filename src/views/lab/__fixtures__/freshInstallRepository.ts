/**
 * A database where every Lab table returned SUCCESSFULLY with zero rows —
 * a fresh install after migrations, before the first project. Every read
 * lands ok; nothing is pending and nothing failed. Empty is the ANSWER
 * (readResult.ts), and every Lab screen must render it as one.
 *
 * Stricter than a real fresh install, deliberately: the migrations seed
 * agents, providers and chains, but a screen that renders over NOTHING
 * renders over the seeds too — the reverse is not true.
 */
import { MockRepository } from '../../../data/mockRepository';
import { okRows } from '../../../data/readResult';

export function freshInstallRepository(): MockRepository {
  const repository = new MockRepository();
  const seam = repository.labEvidence;
  seam.listProjects = async () => okRows([]);
  seam.listSourceDocuments = async () => okRows([]);
  seam.listReferences = async () => okRows([]);
  seam.listCommitmentSources = async () => okRows([]);
  seam.listDatapoints = async () => okRows([]);
  seam.listConflicts = async () => okRows([]);
  seam.listClaims = async () => okRows([]);
  seam.listContradictions = async () => okRows([]);
  seam.listOutputs = async () => okRows([]);
  seam.listTasks = async () => okRows([]);
  seam.listQuestions = async () => okRows([]);
  seam.listSubQuestions = async () => okRows([]);
  seam.listEvidenceRequirements = async () => okRows([]);
  seam.listCandidateSources = async () => okRows([]);
  seam.listModelSpecs = async () => okRows([]);
  seam.listModelSpecParams = async () => okRows([]);
  seam.listModelResults = async () => okRows([]);
  seam.latestSweep = async () => okRows([]);
  seam.listWorkflows = async () => okRows([]);
  repository.lab.listAgents = async () => okRows([]);
  repository.lab.listProviders = async () => okRows([]);
  repository.lab.listRuns = async () => okRows([]);
  repository.lab.listChains = async () => okRows([]);
  return repository;
}
