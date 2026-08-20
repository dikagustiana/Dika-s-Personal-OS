// @vitest-environment jsdom
/**
 * §C from the panel's side: what a person can actually do, and — more to the
 * point — what they cannot.
 *
 * The repository here RECORDS instead of storing, because the interesting
 * assertions are about the payload rather than the round trip. A patch that
 * carries `slot` would still round-trip fine; it would just have moved a box
 * to another column, silently, and the pinned counts would quietly stop
 * being the pinned ones. So every save is inspected for its key set, and the
 * two counts (30 boxes, 12 handoff markers) are re-asserted AFTER an edit.
 *
 * Three failure modes get their own tests because each one loses work:
 *   - a malformed coa line must STOP the save, not disappear from it;
 *   - a failed write must leave the form and the typed text alone;
 *   - a missing history table must NOT take the edit down with it.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { okRows } from '../../data/readResult';
import type {
  FinishLineItem,
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessReference,
  ProcessStep,
} from '../../data/types';
import {
  NEED_KINDS,
  NEED_STATUSES,
  type TextHistoryRow,
} from '../../logic/processTextEdit';
import {
  fixtureGates,
  fixtureLanes,
  fixtureNeeds,
  fixturePhases,
  fixtureStepItems,
  fixtureSteps,
  fixtureTracks,
} from '../../logic/process/seedFixture';
import { useAppStore } from '../../store/appStore';
import { useToastStore } from '../../store/toastStore';
import { FinishLineSwimlane } from './FinishLineSwimlane';

/** Step 9 carries risk, control, note, 4 docs, 6 coa, 4 drivers, 9 needs and gate G02. */
const STEP = '9';

interface Recorder {
  steps: Array<{ id: string; patch: Record<string, unknown> }>;
  needs: Array<{ id: string; patch: Record<string, unknown> }>;
  gates: Array<{ id: string; patch: Record<string, unknown> }>;
  lanes: Array<{ entityCode: string; key: string; patch: Record<string, unknown> }>;
  phases: Array<{ id: string; patch: Record<string, unknown> }>;
  history: TextHistoryRow[][];
  /** Anything reaching the Finish line from this view is a bug, so it is counted. */
  finishLineWrites: string[];
}

function newRecorder(): Recorder {
  return {
    steps: [],
    needs: [],
    gates: [],
    lanes: [],
    phases: [],
    history: [],
    finishLineWrites: [],
  };
}

function seededRepository(
  recorder: Recorder,
  options: { failStepWrite?: boolean; historyTableMissing?: boolean } = {},
): Repository {
  const steps = fixtureSteps();
  const needs = fixtureNeeds();
  const gates = fixtureGates();
  const lanes = fixtureLanes();
  const phases = fixturePhases();
  const forbidden = (name: string) => async () => {
    recorder.finishLineWrites.push(name);
    throw new Error(`${name} must never be reached from the process view`);
  };
  // Every read hands back a FRESH array, the way a real repository does — its
  // rows are built per call from the PostgREST response. Returning the same
  // array object would let the view's `useMemo` keep the pre-save slice and
  // make a working reload look broken.
  return {
    listProcessLanes: async () => okRows([...lanes]),
    listProcessPhases: async () => okRows([...phases]),
    listProcessSteps: async () => okRows([...steps]),
    listProcessGates: async () => okRows([...gates]),
    listProcessNeeds: async () => okRows([...needs]),
    listProcessStepItems: async () => okRows(fixtureStepItems()),
    listProcessTracks: async () => okRows(fixtureTracks()),
    listProcessForms: async () => okRows([]),
    listProcessReferences: async () => okRows<ProcessReference>([]),
    listFinishLineItems: async () => okRows<FinishLineItem>([]),

    updateProcessStepText: async (id: string, patch: Record<string, unknown>) => {
      if (options.failStepWrite) throw new Error('network down');
      recorder.steps.push({ id, patch });
      const index = steps.findIndex((step) => step.id === id);
      steps[index] = { ...steps[index], ...(patch as Partial<ProcessStep>) };
      return steps[index];
    },
    updateProcessNeedText: async (id: string, patch: Record<string, unknown>) => {
      recorder.needs.push({ id, patch });
      const index = needs.findIndex((need) => need.id === id);
      needs[index] = { ...needs[index], ...(patch as Partial<ProcessNeed>) };
      return needs[index];
    },
    updateProcessGateText: async (id: string, patch: Record<string, unknown>) => {
      recorder.gates.push({ id, patch });
      const index = gates.findIndex((gate) => gate.id === id);
      gates[index] = { ...gates[index], ...(patch as Partial<ProcessGate>) };
      return gates[index];
    },
    updateProcessLaneText: async (
      entityCode: string,
      key: string,
      patch: Record<string, unknown>,
    ) => {
      recorder.lanes.push({ entityCode, key, patch });
      const index = lanes.findIndex((lane) => lane.entityCode === entityCode && lane.key === key);
      lanes[index] = { ...lanes[index], ...(patch as Partial<ProcessLane>) };
      return lanes[index];
    },
    updateProcessPhaseText: async (id: string, patch: Record<string, unknown>) => {
      recorder.phases.push({ id, patch });
      const index = phases.findIndex((phase) => phase.id === id);
      phases[index] = { ...phases[index], ...(patch as Partial<ProcessPhase>) };
      return phases[index];
    },
    appendProcessTextHistory: async (rows: TextHistoryRow[]) => {
      if (options.historyTableMissing) return false;
      recorder.history.push(rows);
      return true;
    },

    setCellEdges: forbidden('setCellEdges'),
    setMilestoneEdges: forbidden('setMilestoneEdges'),
    applyFinishLineAccountPaste: forbidden('applyFinishLineAccountPaste'),
  } as unknown as Repository;
}

/** Same layout stub as swimlaneRedesign.test.tsx — jsdom performs no layout. */
function stubLayout() {
  const columnOf = new Map<string, number>();
  const define = (prop: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return get(this as HTMLElement);
      },
    });
  define('scrollWidth', () => 4000);
  define('scrollHeight', () => 1200);
  define('offsetWidth', (el) => (el.dataset.stepLabel ? 168 : 4000));
  define('offsetHeight', (el) => (el.dataset.stepLabel ? 96 : 1200));
  define('offsetTop', (el) => {
    if (!el.dataset.stepLabel) return 0;
    return 46 + (columnOf.get(el.dataset.stepLabel) ?? 0) * 7;
  });
  define('offsetLeft', (el) => {
    const label = el.dataset.stepLabel;
    if (!label) return 0;
    if (!columnOf.has(label)) columnOf.set(label, columnOf.size);
    return 120 + (columnOf.get(label) ?? 0) * 196;
  });
}

function clearLayoutStub() {
  for (const prop of [
    'scrollWidth',
    'scrollHeight',
    'offsetWidth',
    'offsetHeight',
    'offsetTop',
    'offsetLeft',
  ]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
}

const noop = () => {};
let recorder: Recorder;

beforeEach(() => {
  recorder = newRecorder();
  useToastStore.setState({ toasts: [] });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  stubLayout();
});

afterEach(() => {
  cleanup();
  clearLayoutStub();
  vi.unstubAllGlobals();
  useAppStore.setState({ prosesEntity: 'SAMB', prosesFocus: null });
});

function renderSwimlane(options?: { failStepWrite?: boolean; historyTableMissing?: boolean }) {
  useAppStore.setState({
    repository: seededRepository(recorder, options),
    prosesEntity: 'SAMB',
    prosesFocus: null,
  });
  return render(<FinishLineSwimlane onClearItemFilter={noop} onOpenMatrix={noop} />);
}

async function waitForCanvas(container: HTMLElement, boxes = 30) {
  await waitFor(() => {
    expect(container.querySelectorAll('[data-step-label]').length).toBe(boxes);
  });
}

/** Opens the detail panel for a step by clicking its box. */
async function openStep(container: HTMLElement, label = STEP) {
  await waitForCanvas(container);
  fireEvent.click(container.querySelector(`[data-step-label="${label}"]`) as HTMLElement);
  return await screen.findByRole('complementary', { name: `Detail step ${label}` });
}

const field = (panel: HTMLElement, label: string) =>
  within(panel).getByLabelText(label) as HTMLTextAreaElement | HTMLInputElement;

const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });

// --- reading is the default -------------------------------------------------

describe('§C.1 the panel opens READING, not editing', () => {
  it('renders prose, not a wall of inputs — only requested_on is live', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);

    expect(panel.querySelectorAll('textarea')).toHaveLength(0);
    expect(panel.querySelector('[data-editing]')).toBeNull();
    // The 9 need rows keep their date input; nothing else is an input.
    const inputs = [...panel.querySelectorAll('input')];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((input) => input.getAttribute('type') === 'date')).toBe(true);

    // And the prose is on screen as text.
    const step9 = fixtureSteps().find((step) => step.label === STEP);
    expect(within(panel).getByText(step9?.risk as string)).toBeDefined();
  });

  it('one trigger per editable object, and no more', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    // The step itself, its 9 needs, and its gate.
    expect(within(panel).getAllByRole('button', { name: 'Edit teks' })).toHaveLength(1);
    expect(within(panel).getAllByRole('button', { name: 'Edit' })).toHaveLength(9);
    expect(within(panel).getAllByRole('button', { name: 'Edit gate' })).toHaveLength(1);
  });

  it('switching into edit mode hides the step trigger and shows the form', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));

    expect(panel.querySelector('[data-editing="step"]')).not.toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Edit teks' })).toBeNull();
    const step9 = fixtureSteps().find((step) => step.label === STEP);
    expect((field(panel, 'Risiko') as HTMLTextAreaElement).value).toBe(step9?.risk);
    expect((field(panel, 'Nama step') as HTMLInputElement).value).toBe(step9?.name);
  });
});

// --- what a save actually sends --------------------------------------------

describe('§C.2 a save carries text and nothing structural', () => {
  it('sends exactly the nine text columns, with no slot, lane, track or label', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'TIDAK ADA GRN DAN TIDAK ADA GR/IR');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.steps).toHaveLength(1));
    const { id, patch } = recorder.steps[0];
    expect(id).toBe(STEP);
    expect(Object.keys(patch).sort()).toEqual(
      ['co', 'coa', 'control', 'docs', 'drivers', 'gateId', 'name', 'note', 'risk'].sort(),
    );
    for (const forbidden of ['slot', 'laneKey', 'lane_key', 'track', 'entityCode', 'label', 'id']) {
      expect(patch).not.toHaveProperty(forbidden);
    }
    expect(patch.note).toBe('TIDAK ADA GRN DAN TIDAK ADA GR/IR');
  });

  it('a need save carries no stepId', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit' })[0]);
    type(field(panel, 'Sumber'), 'WMS ekspor harian');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.needs).toHaveLength(1));
    expect(Object.keys(recorder.needs[0].patch).sort()).toEqual(
      ['item', 'kind', 'owner', 'requestedOn', 'src', 'status'].sort(),
    );
    expect(recorder.needs[0].patch).not.toHaveProperty('stepId');
  });

  it('a gate save carries no id and no type', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit gate' }));
    type(field(panel, 'Cara membuka'), 'Minta akses modul inbound');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.gates).toHaveLength(1));
    expect(recorder.gates[0].id).toBe('G02');
    expect(Object.keys(recorder.gates[0].patch).sort()).toEqual(
      ['owner', 'sub', 'title', 'unblock'].sort(),
    );
  });

  it('a lane save carries label and description; the key travels as a filter, not a column', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const lane = fixtureLanes()[0];
    fireEvent.click(screen.getByRole('button', { name: lane.label }));

    const panel = await screen.findByRole('complementary', { name: `Lane ${lane.key}` });
    type(field(panel, 'Deskripsi'), 'Diperbarui');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.lanes).toHaveLength(1));
    expect(recorder.lanes[0].key).toBe(lane.key);
    expect(recorder.lanes[0].entityCode).toBe('SAMB');
    expect(Object.keys(recorder.lanes[0].patch).sort()).toEqual(['description', 'label'].sort());
  });

  it('a phase save carries the name only — the ribbon geometry is not editable', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const phase = fixturePhases()[0];
    fireEvent.click(screen.getByRole('button', { name: phase.name }));

    const panel = await screen.findByRole('complementary', { name: 'Fase' });
    type(field(panel, 'Nama fase'), 'Fase satu');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.phases).toHaveLength(1));
    expect(Object.keys(recorder.phases[0].patch)).toEqual(['name']);
    expect(recorder.phases[0].patch.name).toBe('Fase satu');
  });
});

// --- the audit log ----------------------------------------------------------

describe('§C.6 one history row per changed field', () => {
  it('logs the changed field with old and new, and stays silent about the rest', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    const step9 = fixtureSteps().find((step) => step.label === STEP);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'catatan baru');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.history).toHaveLength(1));
    expect(recorder.history[0]).toEqual([
      {
        tableName: 'os_process_steps',
        rowId: STEP,
        field: 'note',
        oldValue: step9?.note ?? null,
        newValue: 'catatan baru',
      },
    ]);
  });

  it('two edited fields make two rows, in one append', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Risiko'), 'risiko baru');
    type(field(panel, 'Kontrol'), 'kontrol baru');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.history).toHaveLength(1));
    expect(recorder.history[0].map((row) => row.field).sort()).toEqual(['control', 'risk']);
  });

  it('a lane row is keyed entity/key, because a lane has no single-column id', async () => {
    const { container } = renderSwimlane();
    await waitForCanvas(container);
    const lane = fixtureLanes()[0];
    fireEvent.click(screen.getByRole('button', { name: lane.label }));
    const panel = await screen.findByRole('complementary', { name: `Lane ${lane.key}` });
    type(field(panel, 'Label lane'), 'GUDANG BARU');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.history).toHaveLength(1));
    expect(recorder.history[0]).toEqual([
      {
        tableName: 'os_process_lanes',
        rowId: `SAMB/${lane.key}`,
        field: 'label',
        oldValue: lane.label,
        newValue: 'GUDANG BARU',
      },
    ]);
  });

  it('a save that changed nothing writes no history rows', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.steps).toHaveLength(1));
    expect(recorder.history[0]).toEqual([]);
  });

  it('the edit SURVIVES a missing history table — migration 55 may not be applied yet', async () => {
    const { container } = renderSwimlane({ historyTableMissing: true });
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'tetap tersimpan');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    // The row write happened and the panel returned to reading — the log's
    // absence cost the audit line, not the edit.
    await waitFor(() => expect(recorder.steps).toHaveLength(1));
    expect(recorder.steps[0].patch.note).toBe('tetap tersimpan');
    expect(recorder.history).toEqual([]);
    await waitFor(() => {
      expect(panel.querySelector('[data-editing="step"]')).toBeNull();
    });
    expect(within(panel).getByText('tetap tersimpan')).toBeDefined();
  });
});

// --- the failure modes that lose work ---------------------------------------

describe('§C.4 a malformed list STOPS the save — it never disappears from it', () => {
  it('names every bad line and writes nothing at all', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));

    const coa = field(panel, 'Akun COA / FSLI — satu baris: kode | keterangan');
    // Line 2 is blank (legitimate), line 3 has no separator, line 5 is empty
    // again, line 6 has an empty label.
    const typed = '6.3.01 | Storing\n\n6.3.02 Sewa gudang\n6.3.03 | Listrik\n\n6.3.04 |';
    type(coa, typed);
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await screen.findByText(/Baris 3/);
    expect(within(panel).getByText(/Baris 3/).textContent).toContain('tidak ada tanda "|"');
    expect(within(panel).getByText(/Baris 6/).textContent).toContain('keterangan kosong');
    // The blank lines produced no complaint of their own.
    expect(within(panel).queryByText(/Baris 2/)).toBeNull();
    expect(within(panel).queryByText(/Baris 5/)).toBeNull();

    // Nothing was written — not the good lines either. A partial save is
    // worse than none.
    expect(recorder.steps).toEqual([]);
    expect(recorder.history).toEqual([]);
    // And every character the user typed is still there.
    expect((coa as HTMLTextAreaElement).value).toBe(typed);
    expect(panel.querySelector('[data-editing="step"]')).not.toBeNull();
  });

  it('fixing the line clears the errors and lets the save through', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    const coa = field(panel, 'Akun COA / FSLI — satu baris: kode | keterangan');
    type(coa, '6.3.02 Sewa gudang');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));
    await screen.findByText(/Baris 1/);

    type(coa, '6.3.02 | Sewa gudang');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(recorder.steps).toHaveLength(1));
    expect(recorder.steps[0].patch.coa).toEqual([{ code: '6.3.02', label: 'Sewa gudang' }]);
    expect(screen.queryByText(/Baris 1/)).toBeNull();
  });

  it('a failed write leaves the form open with the typed text intact, and says so', async () => {
    const { container } = renderSwimlane({ failStepWrite: true });
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'jangan sampai hilang');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    // The toast is raised through the shared mutation wrapper, so read the
    // store rather than the screen — the Toaster is mounted by the shell.
    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    const toast = useToastStore.getState().toasts[0];
    expect(toast.tone).toBe('error');
    expect(toast.message).toContain('Simpan teks step failed');
    expect(toast.retry).toBeTypeOf('function');

    expect(panel.querySelector('[data-editing="step"]')).not.toBeNull();
    expect((field(panel, 'Catatan') as HTMLTextAreaElement).value).toBe('jangan sampai hilang');
    expect(recorder.history).toEqual([]);
  });
});

describe('§C.3 leaving with unsaved work asks first', () => {
  it('prompts on cancel, and "Lanjut mengedit" keeps every keystroke', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'setengah jadi');
    fireEvent.click(within(panel).getByRole('button', { name: 'Batal' }));

    expect(within(panel).getByText(/belum disimpan/)).toBeDefined();
    fireEvent.click(within(panel).getByRole('button', { name: 'Lanjut mengedit' }));
    expect((field(panel, 'Catatan') as HTMLTextAreaElement).value).toBe('setengah jadi');
    expect(recorder.steps).toEqual([]);
  });

  it('"Buang perubahan" returns to reading with the ORIGINAL text, unwritten', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    const step9 = fixtureSteps().find((step) => step.label === STEP);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Catatan'), 'setengah jadi');
    fireEvent.click(within(panel).getByRole('button', { name: 'Batal' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Buang perubahan' }));

    expect(panel.querySelector('[data-editing="step"]')).toBeNull();
    expect(within(panel).getByText(step9?.note as string)).toBeDefined();
    expect(within(panel).queryByText('setengah jadi')).toBeNull();
    expect(recorder.steps).toEqual([]);
    expect(recorder.history).toEqual([]);
  });

  it('cancelling a clean form leaves at once — nothing to lose, nothing to ask', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Batal' }));

    expect(within(panel).queryByText(/belum disimpan/)).toBeNull();
    expect(panel.querySelector('[data-editing="step"]')).toBeNull();
  });
});

// --- the constrained columns ------------------------------------------------

describe('§C.5 kind and status can only be set to a value the CHECK accepts', () => {
  it('offers them as selects over exactly the seeded vocabulary', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit' })[0]);

    const kind = within(panel).getByLabelText('Jenis') as HTMLSelectElement;
    const status = within(panel).getByLabelText('Status') as HTMLSelectElement;
    expect(kind.tagName).toBe('SELECT');
    expect(status.tagName).toBe('SELECT');
    expect([...kind.options].map((option) => option.value)).toEqual([...NEED_KINDS]);
    expect([...status.options].map((option) => option.value)).toEqual([...NEED_STATUSES]);
    // No free-text way in: the panel has no text input for either column.
    expect(within(panel).queryByRole('textbox', { name: 'Jenis' })).toBeNull();
    expect(within(panel).queryByRole('textbox', { name: 'Status' })).toBeNull();
  });

  it('saves the picked value, and the whole read path re-runs behind it', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    const stepNeeds = fixtureNeeds().filter((need) => need.stepId === STEP);
    const index = stepNeeds.findIndex((need) => need.status === 'BELUM');
    expect(index).toBeGreaterThan(-1);

    fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit' })[index]);
    type(within(panel).getByLabelText('Status'), 'ADA');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(recorder.needs).toHaveLength(1));
    expect(recorder.needs[0].id).toBe(stepNeeds[index].id);
    expect(recorder.needs[0].patch.status).toBe('ADA');

    // The canvas follows: the box's "N belum" chip drops by one. That count
    // is derived from the RELOADED rows, so it moving is what proves
    // saveText's load() ran rather than state being spliced by hand.
    const belumBefore = fixtureNeeds().filter(
      (need) => need.stepId === STEP && need.status === 'BELUM',
    ).length;
    expect(belumBefore).toBeGreaterThan(0);
    await waitFor(() => {
      const box = container.querySelector(`[data-step-label="${STEP}"]`) as HTMLElement;
      expect(box.textContent).toContain(`${belumBefore - 1} belum`);
    });
  });
});

// --- editing must not move the diagram --------------------------------------

describe('§C.9 the pinned SAMB numbers survive an edit', () => {
  it('30 boxes and 12 handoff markers, before and after saving text', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(12);

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Nama step'), 'Nama yang jauh lebih panjang daripada sebelumnya');
    type(field(panel, 'Catatan'), 'catatan baru');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(recorder.steps).toHaveLength(1));

    await waitFor(() => {
      expect(container.querySelectorAll('[data-step-label]')).toHaveLength(30);
    });
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(12);
    // Per-track counts too: the split walks `track`, which no patch can name.
    fireEvent.click(screen.getByRole('button', { name: 'TRADE' }));
    await waitForCanvas(container, 19);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'LP' }));
    await waitForCanvas(container, 20);
    expect(container.querySelectorAll('[data-handoff-marker]')).toHaveLength(7);
  });

  it('never reaches os_finish_line_* — not a cell, not a milestone, not an account', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    type(field(panel, 'Kontrol'), 'kontrol baru');
    fireEvent.click(within(panel).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(recorder.steps).toHaveLength(1));
    expect(recorder.finishLineWrites).toEqual([]);
  });

  it('offers no way to add or delete a row — editing is the whole surface', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    for (const forbidden of [/tambah/i, /hapus/i, /baru/i, /duplikat/i]) {
      expect(within(panel).queryByRole('button', { name: forbidden })).toBeNull();
    }
  });
});

// --- the app's own rules ----------------------------------------------------

describe('§C.12 the panel obeys the app rules while editing', () => {
  it('carries exactly one filled primary — the save button', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    // Reading state: none at all, as on the rest of this view.
    expect(panel.querySelectorAll('button.bg-primary')).toHaveLength(0);

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    const primaries = [...panel.querySelectorAll('button.bg-primary')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toBe('Simpan');
  });

  it('uses no font-mono anywhere, in any state', async () => {
    const { container } = renderSwimlane();
    const panel = await openStep(container);
    expect(panel.querySelectorAll('[class*="font-mono"]')).toHaveLength(0);

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit teks' }));
    expect(panel.querySelectorAll('[class*="font-mono"]')).toHaveLength(0);
    // The step form replaces the whole reading view, so leave it before
    // reaching for a need row.
    fireEvent.click(within(panel).getByRole('button', { name: 'Batal' }));

    fireEvent.click(within(panel).getAllByRole('button', { name: 'Edit' })[0]);
    expect(panel.querySelectorAll('[class*="font-mono"]')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Batal' }));

    fireEvent.click(within(panel).getByRole('button', { name: 'Edit gate' }));
    expect(panel.querySelectorAll('[class*="font-mono"]')).toHaveLength(0);
    // Codes stay tabular-nums, as everywhere else in the app.
    expect(container.querySelectorAll('[class*="tabular-nums"]').length).toBeGreaterThan(0);
  });

  it('opening a lane or phase closes the step panel — one editor at a time', async () => {
    const { container } = renderSwimlane();
    await openStep(container);
    fireEvent.click(screen.getByRole('button', { name: fixtureLanes()[0].label }));

    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: `Detail step ${STEP}` })).toBeNull();
    });
    expect(
      screen.getByRole('complementary', { name: `Lane ${fixtureLanes()[0].key}` }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: fixturePhases()[0].name }));
    await waitFor(() => {
      expect(
        screen.queryByRole('complementary', { name: `Lane ${fixtureLanes()[0].key}` }),
      ).toBeNull();
    });
    expect(screen.getByRole('complementary', { name: 'Fase' })).toBeDefined();
  });
});
