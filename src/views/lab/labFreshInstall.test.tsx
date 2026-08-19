// @vitest-environment jsdom
//
// A fresh install — migrations applied, zero rows anywhere — must render
// EVERY Lab screen. Empty is an answer (readResult.ts): each screen says
// what its emptiness means in words; none may hang at `Checking…` (the
// 2026-08-19 Flow bug, audited here as a class), and none may dress the
// emptiness up as an error.
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { mockRepository } from '../../data/mockRepository';
import { useAppStore } from '../../store/appStore';
import { freshInstallRepository } from './__fixtures__/freshInstallRepository';
import { LabChains } from './LabChains';
import { LabRegistry } from './LabRegistry';
import { LabRun } from './LabRun';
import { LabRuns } from './LabRuns';
import { LabEvidence } from './evidence/LabEvidence';
import { LabFlow } from './flow/LabFlow';

afterEach(() => {
  cleanup();
  useAppStore.setState({ repository: mockRepository, area: 'work', labView: 'registry' });
});

const SCREENS: Array<{ name: string; element: ReactElement }> = [
  { name: 'Registry', element: <LabRegistry /> },
  { name: 'Run', element: <LabRun /> },
  { name: 'Run log', element: <LabRuns /> },
  { name: 'Chains', element: <LabChains /> },
  { name: 'Evidence', element: <LabEvidence /> },
  { name: 'Flow', element: <LabFlow /> },
];

describe('fresh install: every Lab screen renders over an all-empty database', () => {
  for (const entry of SCREENS) {
    it(`${entry.name} resolves past Checking and shows no failure`, async () => {
      useAppStore.setState({ repository: freshInstallRepository(), area: 'lab' });
      render(entry.element);
      // Every read returns (ok, zero rows) — so Checking must clear…
      await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
      // …and emptiness is an answer, not a failure.
      expect(screen.queryByText('Could not check')).toBeNull();
    });
  }
});
