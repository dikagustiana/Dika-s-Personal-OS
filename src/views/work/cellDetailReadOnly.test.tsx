// @vitest-environment jsdom
/**
 * A read grant, from the contributor's side of the cell panel. Before
 * 20260904000095 a contributor either could write a cell (own entity) or
 * could not see it at all; now a cell can be visible AND read-only, and the
 * panel has to say so instead of offering editors that the database will
 * refuse with "Cell not found".
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishLineCell, FinishLineItem } from '../../data/types';
import { CellDetailPanel } from './CellDetailPanel';

const ITEM: FinishLineItem = { id: 'm1', item: 'Kas', kind: 'metric', parentId: 's1', order: 3 };
const CELL = {
  id: 'cell-1',
  itemId: 'm1',
  entityCode: 'SAMB',
  state: 'input',
  actorKind: 'owner',
} as FinishLineCell;

const REASON = 'Akses baca saja: section ini diberikan ke kamu tanpa hak tulis.';

function mount(canWrite: boolean) {
  return render(
    <CellDetailPanel
      cell={CELL}
      item={ITEM}
      entityLabel="Sambungan"
      accounts={[]}
      accountsKnown={false}
      viewerKind="contributor"
      canWrite={canWrite}
      readOnlyReason={canWrite ? undefined : REASON}
      isPending={false}
      onSetState={vi.fn()}
      onSetNote={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

afterEach(() => cleanup());

describe('a contributor on a read-only cell', () => {
  it('sees the reason and no editors', () => {
    mount(false);
    expect(screen.getByText(REASON)).toBeTruthy();
    expect(screen.queryByText('Ubah state')).toBeNull();
    expect(screen.queryByRole('button', { name: /catatan/i })).toBeNull();
  });

  it('sees the editors and no reason when the grant is write', () => {
    mount(true);
    expect(screen.getByText('Ubah state')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tulis catatan/i })).toBeTruthy();
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
