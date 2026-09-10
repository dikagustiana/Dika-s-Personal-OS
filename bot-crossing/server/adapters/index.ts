import { autogenAdapter } from './autogen';
import { crewaiAdapter } from './crewai';
import { customAdapter } from './custom';
import { langgraphAdapter } from './langgraph';
import type { Adapter, AdapterName } from './types';

export const ADAPTERS: Record<AdapterName, Adapter> = {
  langgraph: langgraphAdapter,
  crewai: crewaiAdapter,
  autogen: autogenAdapter,
  custom: customAdapter,
};

export function isAdapterName(s: string): s is AdapterName {
  return s in ADAPTERS;
}
