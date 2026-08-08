import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/appStore';
import type {
  IeltsBandConversion,
  IeltsPractice,
  IeltsPracticeTopic,
  IeltsPrepConfig,
  IeltsTopic,
} from '../../../data/types';
import { deriveWeaknessFromErrors, type ErrorBridgeResult } from '../../../logic/ielts/weakness';
import { Ielts } from '../Ielts';
import { LogPractice } from './LogPractice';
import { MethodReader } from './MethodReader';
import { PrepDashboard } from './PrepDashboard';
import { Weakness } from './Weakness';

/**
 * IELTS IS ONE NAV ENTRY WITH TABS, following the Finish line's precedent.
 *
 * Prep, Log, Weakness and Method are four faces of one question — what to
 * work on next — and splitting them into sidebar entries would put three
 * levels of navigation in front of two screens. `Bands & errors` is the
 * pre-existing IELTS view, unchanged and kept: it tracks full-mock band
 * results and the pasted-feedback error log, which is a different grain from
 * the per-question-type tracker and is not superseded by it.
 *
 * NO URL, on purpose. The Finish line owns the only address in this app;
 * everything else is store or local state. The weakness → method deep link is
 * therefore a tab switch plus a slug, which is what "deep link" means in this
 * app's idiom — and both routes into the reader (the index, and a weakness
 * row) land on the same page for the same slug.
 */

type Tab = 'prep' | 'log' | 'weakness' | 'method' | 'bands';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'prep', label: 'Prep' },
  { id: 'log', label: 'Log session' },
  { id: 'weakness', label: 'Weakness' },
  { id: 'method', label: 'Method' },
  { id: 'bands', label: 'Bands & errors' },
];

const DEFAULT_METHOD_SLUG = 'reading/overview';

export function IeltsArea() {
  const repository = useAppStore((state) => state.repository);

  const [tab, setTab] = useState<Tab>('prep');
  const [methodSlug, setMethodSlug] = useState(DEFAULT_METHOD_SLUG);

  const [topics, setTopics] = useState<IeltsTopic[]>([]);
  const [practices, setPractices] = useState<IeltsPractice[]>([]);
  const [practiceTopics, setPracticeTopics] = useState<IeltsPracticeTopic[]>([]);
  const [bandConversion, setBandConversion] = useState<IeltsBandConversion[]>([]);
  const [config, setConfig] = useState<IeltsPrepConfig | null>(null);
  const [bridge, setBridge] = useState<ErrorBridgeResult | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * SIX READS, SETTLED INDEPENDENTLY.
   *
   * This was one Promise.all over five reads, which meant a single failing RPC
   * rejected the lot and left all five states at their initial empty values —
   * the weakness list, the method index and the dashboard all blank because
   * one of them could not be read. Adding the error log as a sixth read makes
   * that worse rather than better: os_ielts_errors is the newest and least
   * load-bearing of the six, and it should not be able to blank the tracker
   * that worked perfectly well before it existed.
   *
   * allSettled applies each result on its own. A read that fails leaves its
   * own slice empty and NAMES ITSELF in the banner, which is strictly more
   * information than one message for six possible causes.
   *
   * The banner stays suppressed on the `bands` tab, unchanged: that tab is the
   * pre-existing view and loads its own data, so a prep-read failure is not
   * its problem to announce.
   */
  const load = useCallback(async () => {
    const [topicRows, practiceRows, tagRows, conversionRows, configRow, errorRows] =
      await Promise.allSettled([
        repository.listIeltsTopics(),
        repository.listIeltsPractice(),
        repository.listIeltsPracticeTopics(),
        repository.listIeltsBandConversion(),
        repository.getIeltsPrepConfig(),
        repository.listIeltsErrors(),
      ]);

    const failed: string[] = [];
    const reason = (result: PromiseRejectedResult) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason);

    if (topicRows.status === 'fulfilled') setTopics(topicRows.value);
    else failed.push(reason(topicRows));

    if (practiceRows.status === 'fulfilled') setPractices(practiceRows.value);
    else failed.push(reason(practiceRows));

    if (tagRows.status === 'fulfilled') setPracticeTopics(tagRows.value);
    else failed.push(reason(tagRows));

    if (conversionRows.status === 'fulfilled') setBandConversion(conversionRows.value);
    else failed.push(reason(conversionRows));

    if (configRow.status === 'fulfilled') setConfig(configRow.value);
    else failed.push(reason(configRow));

    // Mapped here, once, rather than inside each view's useMemo: two views
    // rank the same evidence and computing it twice is how they drift.
    if (errorRows.status === 'fulfilled') setBridge(deriveWeaknessFromErrors(errorRows.value));
    else failed.push(reason(errorRows));

    // Said out loud rather than rendered as an empty weakness list. "Nothing
    // to work on" and "the read failed" look identical otherwise, and the
    // first is a much more comfortable thing to believe.
    setLoadError(failed.length > 0 ? failed.join(' · ') : null);
  }, [repository]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The deep link. Both the weakness rows and the dashboard call this. */
  const openMethod = useCallback((slug: string) => {
    setMethodSlug(slug);
    setTab('method');
  }, []);

  const go = useCallback((next: Tab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return (
    <div className="page-shell">
      <header className="mb-6 border-b border-border-subtle pb-6">
        <p className="page-kicker">Growth / IELTS</p>
        <h1 className="page-title">IELTS</h1>
      </header>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={cn(
              'min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground-secondary',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loadError && tab !== 'bands' && (
        <p className="mb-5 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load the IELTS prep data — {loadError}
        </p>
      )}

      {tab === 'prep' && (
        <PrepDashboard
          config={config}
          topics={topics}
          practices={practices}
          practiceTopics={practiceTopics}
          bridge={bridge}
          onOpenMethod={openMethod}
          onGoToWeakness={() => go('weakness')}
        />
      )}

      {tab === 'log' && (
        <LogPractice
          topics={topics}
          bandConversion={bandConversion}
          // Re-read rather than splice the new row in: the tag rows come from
          // a second table, and reconstructing them client-side is how the
          // weakness view and the database drift apart on the first save.
          onLogged={() => void load()}
        />
      )}

      {tab === 'weakness' && (
        <Weakness
          topics={topics}
          practices={practices}
          practiceTopics={practiceTopics}
          bridge={bridge}
          onOpenMethod={openMethod}
        />
      )}

      {tab === 'method' && (
        <MethodReader topics={topics} slug={methodSlug} onSelect={setMethodSlug} />
      )}

      {/* The pre-existing view, embedded: this area already owns the page
          shell and the page's one <h1>, so it renders without either. */}
      {tab === 'bands' && <Ielts embedded />}
    </div>
  );
}
