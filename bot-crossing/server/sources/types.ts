import type { OutputDocument } from '../eventBus';

/** What a source can do to the world. Same surface for the mock and for live adapters (A-5). */
export interface SourceContext {
  publish(event: unknown): boolean;
  publishRaw(text: string): void;
  storeOutput(doc: OutputDocument): void;
  log(msg: string): void;
}

export interface EventSource {
  readonly name: string;
  start(ctx: SourceContext): void | Promise<void>;
  stop(): void;
}
