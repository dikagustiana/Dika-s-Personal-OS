/**
 * SupabaseTransport — the stub for the real backend (contract v2). Every
 * method throws until the agent runtime on the VPS is wired; the UI never
 * calls it in this build. UI code talks only to the FsreTransport
 * interface, so dropping the real implementation in needs no UI changes.
 */
import type { Agent, AgentEvent, Command, Engagement, FsreTransport, IndustryProgressRow } from './contract';

function notWired(): never {
  throw new Error('Not wired yet');
}

export class SupabaseTransport implements FsreTransport {
  subscribeEvents(_cb: (e: AgentEvent) => void): () => void {
    notWired();
  }
  async listAgents(): Promise<Agent[]> {
    notWired();
  }
  async listEngagements(): Promise<Engagement[]> {
    notWired();
  }
  async proposeEngagement(): Promise<Engagement> {
    notWired();
  }
  async startEngagement(): Promise<Engagement> {
    notWired();
  }
  async cancelEngagement(): Promise<Engagement> {
    notWired();
  }
  async sendCommand(): Promise<Command> {
    notWired();
  }
  async listCommands(): Promise<Command[]> {
    notWired();
  }
  async getIndustryProgress(): Promise<IndustryProgressRow[]> {
    notWired();
  }
  async approveVersion(): Promise<{ ok: boolean; lockedReason: string | null }> {
    notWired();
  }
}
