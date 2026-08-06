/**
 * The five edit forms, one per editable row kind. Each is READ-MODE-FIRST:
 * the panel renders its reading view, an "Edit teks" trigger swaps in the
 * form, and save/cancel are explicit. Nothing here can touch structure — the
 * patch types (logic/processTextEdit.ts) cannot name label, slot, lane_key,
 * track, entity_code or any id, so a payload carrying one does not typecheck.
 *
 * Every form follows the same three steps on save:
 *   1. parse the list fields, and STOP on failure with the line numbers;
 *   2. write the row;
 *   3. append one audit row per changed field — and if the history table is
 *      not there yet, skip it silently. The edit is never lost because its
 *      log could not be written.
 */
import { useState } from 'react';
import type {
  ProcessGate,
  ProcessLane,
  ProcessNeed,
  ProcessPhase,
  ProcessStep,
} from '../../data/types';
import {
  NEED_KINDS,
  NEED_STATUSES,
  diffForHistory,
  formatCoaList,
  formatLineList,
  isDirty,
  parseCoaList,
  parseLineList,
  type ParseFailure,
  type ProcessGateTextWrite,
  type ProcessLaneTextWrite,
  type ProcessNeedTextWrite,
  type ProcessPhaseTextWrite,
  type ProcessStepTextWrite,
  type TextHistoryRow,
} from '../../logic/processTextEdit';
import {
  DiscardPrompt,
  EditActions,
  EditDate,
  EditField,
  EditSelect,
  ParseErrors,
  useEditMode,
} from './ProcessTextEditor';

/** `''` from an input means "absent", the same rule the row mappers apply. */
const orNull = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);

/**
 * What a form needs from the view: whether a write is in flight, and one
 * function that performs the write and then appends the audit rows. The
 * repository call is bound by the panel and handed in — the forms stay
 * presentational and nothing module-level is mutated to wire them.
 */
export interface SaveContext<TPatch> {
  isPending: boolean;
  /** Writes, then appends history. Returns true when the row actually stuck. */
  submit: (patch: TPatch, history: TextHistoryRow[]) => Promise<boolean>;
}

// --- step -------------------------------------------------------------------

export function StepTextForm({
  step,
  gates,
  context,
  onDone,
}: {
  step: ProcessStep;
  gates: ProcessGate[];
  context: SaveContext<ProcessStepTextWrite>;
  onDone: () => void;
}) {
  const initial = {
    name: step.name,
    co: step.co ?? '',
    risk: step.risk ?? '',
    control: step.control ?? '',
    note: step.note ?? '',
    gateId: step.gateId ?? '',
    docs: formatLineList(step.docs),
    coa: formatCoaList(step.coa),
    drivers: formatLineList(step.drivers),
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<ParseFailure[]>([]);
  const mode = useEditMode(isDirty(initial, form));
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const onSave = async () => {
    const docs = parseLineList(form.docs);
    const drivers = parseLineList(form.drivers);
    const coa = parseCoaList(form.coa);
    // Stop before writing anything: a partial save is worse than none.
    if (!coa.ok || !docs.ok || !drivers.ok) {
      setErrors([
        ...(coa.ok ? [] : coa.errors),
        ...(docs.ok ? [] : docs.errors),
        ...(drivers.ok ? [] : drivers.errors),
      ]);
      return;
    }
    setErrors([]);
    const patch: ProcessStepTextWrite = {
      name: form.name.trim(),
      co: orNull(form.co),
      risk: orNull(form.risk),
      control: orNull(form.control),
      note: orNull(form.note),
      gateId: orNull(form.gateId),
      docs: docs.value,
      coa: coa.value,
      drivers: drivers.value,
    };
    // The audit diff compares STORED shape to STORED shape, never the form's
    // display shape. `initial` holds the textareas' text — docs and drivers
    // newline-joined, coa as `kode | keterangan` lines — and diffing that
    // against the parsed arrays would log all three as changed on EVERY save,
    // including one that changed nothing. Rows nobody edited must produce no
    // history at all, or the log stops answering the only question it exists
    // to answer.
    const before = {
      name: step.name,
      co: step.co ?? null,
      risk: step.risk ?? null,
      control: step.control ?? null,
      note: step.note ?? null,
      gateId: step.gateId ?? null,
      docs: step.docs,
      coa: step.coa,
      drivers: step.drivers,
    };
    const history = diffForHistory('os_process_steps', step.id, before, {
      name: patch.name,
      co: patch.co,
      risk: patch.risk,
      control: patch.control,
      note: patch.note,
      gateId: patch.gateId,
      docs: patch.docs,
      coa: patch.coa,
      drivers: patch.drivers,
    });
    const ok = await context.submit(patch, history);
    if (ok) {
      mode.finish();
      onDone();
    }
  };

  return (
    <div data-editing="step">
      <EditField label="Nama step" value={form.name} onChange={set('name')} />
      <EditField label="Sub-fungsi (co)" value={form.co} onChange={set('co')} />
      <EditField label="Risiko" value={form.risk} onChange={set('risk')} rows={4} />
      <EditField label="Kontrol" value={form.control} onChange={set('control')} rows={4} />
      <EditField label="Catatan" value={form.note} onChange={set('note')} rows={4} />
      <EditSelect
        label="Gate"
        value={form.gateId}
        onChange={set('gateId')}
        options={[
          { value: '', label: '— tanpa gate —' },
          ...gates.map((gate) => ({ value: gate.id, label: `${gate.id} · ${gate.title}` })),
        ]}
      />
      <EditField
        label="Dokumen & sistem — satu baris satu item"
        value={form.docs}
        onChange={set('docs')}
        rows={4}
      />
      <EditField
        label="Akun COA / FSLI — satu baris: kode | keterangan"
        value={form.coa}
        onChange={set('coa')}
        rows={4}
        placeholder="6.3.01 | Storing — Manpower"
      />
      <EditField
        label="Driver alokasi — satu baris satu item"
        value={form.drivers}
        onChange={set('drivers')}
        rows={4}
      />
      <ParseErrors errors={errors} />
      {mode.confirming ? (
        <DiscardPrompt onDiscard={onDone} onKeepEditing={mode.keepEditing} />
      ) : (
        <EditActions
          onSave={() => void onSave()}
          onCancel={() => (isDirty(initial, form) ? mode.requestCancel() : onDone())}
          isPending={context.isPending}
        />
      )}
    </div>
  );
}

// --- need -------------------------------------------------------------------

export function NeedTextForm({
  need,
  context,
  onDone,
}: {
  need: ProcessNeed;
  context: SaveContext<ProcessNeedTextWrite>;
  onDone: () => void;
}) {
  const initial = {
    item: need.item,
    kind: need.kind as string,
    src: need.src ?? '',
    owner: need.owner ?? '',
    status: need.status as string,
    requestedOn: need.requestedOn ?? '',
  };
  const [form, setForm] = useState(initial);
  const mode = useEditMode(isDirty(initial, form));
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const onSave = async () => {
    const patch: ProcessNeedTextWrite = {
      item: form.item.trim(),
      kind: form.kind,
      src: orNull(form.src),
      owner: orNull(form.owner),
      status: form.status,
      requestedOn: orNull(form.requestedOn),
    };
    const history = diffForHistory('os_process_needs', need.id, initial, {
      item: patch.item,
      kind: patch.kind,
      src: patch.src,
      owner: patch.owner,
      status: patch.status,
      requestedOn: patch.requestedOn,
    });
    const ok = await context.submit(patch, history);
    if (ok) {
      mode.finish();
      onDone();
    }
  };

  return (
    <div data-editing="need">
      <EditField label="Data yang dibutuhkan" value={form.item} onChange={set('item')} rows={2} />
      <EditSelect
        label="Jenis"
        value={form.kind}
        onChange={set('kind')}
        options={NEED_KINDS.map((kind) => ({ value: kind, label: kind }))}
      />
      <EditSelect
        label="Status"
        value={form.status}
        onChange={set('status')}
        options={NEED_STATUSES.map((status) => ({ value: status, label: status }))}
      />
      <EditField label="Sumber" value={form.src} onChange={set('src')} />
      <EditField label="Pemilik" value={form.owner} onChange={set('owner')} />
      <EditDate label="Diminta" value={form.requestedOn} onChange={set('requestedOn')} />
      {mode.confirming ? (
        <DiscardPrompt onDiscard={onDone} onKeepEditing={mode.keepEditing} />
      ) : (
        <EditActions
          onSave={() => void onSave()}
          onCancel={() => (isDirty(initial, form) ? mode.requestCancel() : onDone())}
          isPending={context.isPending}
        />
      )}
    </div>
  );
}

// --- gate -------------------------------------------------------------------

export function GateTextForm({
  gate,
  context,
  onDone,
}: {
  gate: ProcessGate;
  context: SaveContext<ProcessGateTextWrite>;
  onDone: () => void;
}) {
  const initial = {
    title: gate.title,
    sub: gate.sub ?? '',
    owner: gate.owner ?? '',
    unblock: gate.unblock ?? '',
  };
  const [form, setForm] = useState(initial);
  const mode = useEditMode(isDirty(initial, form));
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const onSave = async () => {
    const patch: ProcessGateTextWrite = {
      title: form.title.trim(),
      sub: orNull(form.sub),
      owner: orNull(form.owner),
      unblock: orNull(form.unblock),
    };
    const history = diffForHistory('os_process_gates', gate.id, initial, { ...patch });
    const ok = await context.submit(patch, history);
    if (ok) {
      mode.finish();
      onDone();
    }
  };

  return (
    <div data-editing="gate">
      <EditField label="Judul gate" value={form.title} onChange={set('title')} rows={2} />
      <EditField label="Sub" value={form.sub} onChange={set('sub')} />
      <EditField label="Pemilik" value={form.owner} onChange={set('owner')} />
      <EditField label="Cara membuka" value={form.unblock} onChange={set('unblock')} rows={4} />
      {mode.confirming ? (
        <DiscardPrompt onDiscard={onDone} onKeepEditing={mode.keepEditing} />
      ) : (
        <EditActions
          onSave={() => void onSave()}
          onCancel={() => (isDirty(initial, form) ? mode.requestCancel() : onDone())}
          isPending={context.isPending}
        />
      )}
    </div>
  );
}

// --- lane and phase ---------------------------------------------------------

export function LaneTextForm({
  lane,
  context,
  onDone,
}: {
  lane: ProcessLane;
  context: SaveContext<ProcessLaneTextWrite>;
  onDone: () => void;
}) {
  const initial = { label: lane.label, description: lane.description ?? '' };
  const [form, setForm] = useState(initial);
  const mode = useEditMode(isDirty(initial, form));

  const onSave = async () => {
    const patch: ProcessLaneTextWrite = {
      label: form.label.trim(),
      description: orNull(form.description),
    };
    const history = diffForHistory(
      'os_process_lanes',
      `${lane.entityCode}/${lane.key}`,
      initial,
      { ...patch },
    );
    const ok = await context.submit(patch, history);
    if (ok) {
      mode.finish();
      onDone();
    }
  };

  return (
    <div data-editing="lane">
      <EditField
        label="Label lane"
        value={form.label}
        onChange={(value) => setForm((current) => ({ ...current, label: value }))}
      />
      <EditField
        label="Deskripsi"
        value={form.description}
        onChange={(value) => setForm((current) => ({ ...current, description: value }))}
        rows={2}
      />
      {mode.confirming ? (
        <DiscardPrompt onDiscard={onDone} onKeepEditing={mode.keepEditing} />
      ) : (
        <EditActions
          onSave={() => void onSave()}
          onCancel={() => (isDirty(initial, form) ? mode.requestCancel() : onDone())}
          isPending={context.isPending}
        />
      )}
    </div>
  );
}

export function PhaseTextForm({
  phase,
  context,
  onDone,
}: {
  phase: ProcessPhase;
  context: SaveContext<ProcessPhaseTextWrite>;
  onDone: () => void;
}) {
  const initial = { name: phase.name };
  const [form, setForm] = useState(initial);
  const mode = useEditMode(isDirty(initial, form));

  const onSave = async () => {
    const patch: ProcessPhaseTextWrite = { name: form.name.trim() };
    const history = diffForHistory('os_process_phases', phase.id, initial, { ...patch });
    const ok = await context.submit(patch, history);
    if (ok) {
      mode.finish();
      onDone();
    }
  };

  return (
    <div data-editing="phase">
      <EditField
        label="Nama fase"
        value={form.name}
        onChange={(value) => setForm({ name: value })}
      />
      {mode.confirming ? (
        <DiscardPrompt onDiscard={onDone} onKeepEditing={mode.keepEditing} />
      ) : (
        <EditActions
          onSave={() => void onSave()}
          onCancel={() => (isDirty(initial, form) ? mode.requestCancel() : onDone())}
          isPending={context.isPending}
        />
      )}
    </div>
  );
}
