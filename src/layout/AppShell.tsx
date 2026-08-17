import {
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  ChevronRight,
  FileText,
  Flag,
  FlaskConical,
  Focus,
  Globe,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Lock,
  Menu,
  Play,
  RefreshCw,
  ScrollText,
  Target,
  Trophy,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { isSupabaseConfigured, signOutCollaborator } from '../data/supabaseRepository';
import { lockApp } from '../components/PassphraseGate';
import { cn } from '../lib/utils';
import {
  useAppStore,
  type GrowthView,
  type LabView,
  type ShellArea,
  type WorkView,
} from '../store/appStore';
import { Button } from '../components/ui/Button';
import { LANTERN_ALT, LanternPhoto } from '../components/ui/LanternPhoto';

// `short` is the compact label used in the mobile bottom strip.
const workNav: Array<{ id: WorkView; label: string; short: string; icon: typeof Focus }> = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
  { id: 'today', label: 'Today', short: 'Today', icon: Focus },
  { id: 'week', label: 'Week', short: 'Week', icon: CalendarDays },
  { id: 'projects', label: 'Projects', short: 'Projects', icon: Target },
  // One entry, three tabs: the matrix, the SAMB swimlane and the data-needs
  // register all live behind this. They are the same subject — the target
  // and the road to it — so they are not separate rail entries.
  { id: 'finish-line', label: 'Finish line', short: 'Finish', icon: Flag },
  { id: 'monthly-close', label: 'Monthly close', short: 'Close', icon: RefreshCw },
  { id: 'escalations', label: 'Escalations', short: 'Escalate', icon: Megaphone },
];

// The first entry reads just "Dashboard" — the workspace toggle directly
// above already says which one, and the longer label wrapped the rail.
const growthNav: Array<{ id: GrowthView; label: string; short: string; icon: typeof Focus }> = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
  { id: 'ielts', label: 'IELTS', short: 'IELTS', icon: BookOpen },
  { id: 'uni', label: 'Uni Applications', short: 'Uni', icon: GraduationCap },
  { id: 'chevening', label: 'Chevening', short: 'Chevening', icon: Trophy },
  { id: 'lpdp', label: 'LPDP', short: 'LPDP', icon: FileText },
  { id: 'research', label: 'Research', short: 'Research', icon: FlaskConical },
  { id: 'website', label: 'Website', short: 'Website', icon: Globe },
  // Last: the initiatives are the everyday entry points, and this is the
  // whole-forest fallback for anything not behind one of them.
  { id: 'projects', label: 'Projects', short: 'Projects', icon: Target },
];

// LAB: the agent harness. Registry first — it is the inventory everything
// else operates on; the chain builder is deliberately last (the most fun and
// the least useful first, per the lab brief).
const labNav: Array<{ id: LabView; label: string; short: string; icon: typeof Focus }> = [
  { id: 'registry', label: 'Registry', short: 'Agents', icon: Bot },
  { id: 'run', label: 'Run', short: 'Run', icon: Play },
  { id: 'runs', label: 'Run log', short: 'Log', icon: ScrollText },
  { id: 'chains', label: 'Chains', short: 'Chains', icon: Workflow },
  // The epistemic layer: what stands behind a number. Last in the rail but
  // upstream of everything an output claims.
  { id: 'evidence', label: 'Evidence', short: 'Evidence', icon: BookMarked },
];

function WorkspaceSwitch({
  area,
  onChange,
}: {
  area: ShellArea;
  onChange: (area: ShellArea) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-border-subtle bg-background p-1">
      {(['work', 'growth', 'lab'] as const).map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          aria-pressed={area === item}
          className={cn(
            // px-1, not px-3: three cells share the rail now, and GROWTH at
            // this tracking overflows a padded third — the labels centre, so
            // the padding was never load-bearing.
            'h-9 rounded-sm px-1 text-xs font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            area === item
              ? 'bg-accent text-foreground'
              : 'text-foreground-muted hover:text-foreground-secondary',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function BuildStamp() {
  // __BUILD_TIME__ is an ISO-8601 UTC instant. Take its fields verbatim
  // rather than formatting through a Date, which would silently convert to
  // the browser's timezone while the label still said UTC.
  const built = __BUILD_TIME__.slice(0, 16).replace('T', ' ');
  return (
    <p className="mt-2 text-[10px] tabular-nums text-foreground-muted">
      {__BUILD_SHA__} · {built} UTC
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 'closing' keeps the drawer mounted long enough for the exit transition —
  // the one animation this app has. Everything else stays near-zero-motion.
  const [drawerClosing, setDrawerClosing] = useState(false);
  // Entered flips true one frame AFTER mount: an element that mounts already
  // in its open state never transitions, so without this the drawer would
  // still teleport in and only animate out.
  const [drawerEntered, setDrawerEntered] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);

  const closeDrawer = useCallback(() => {
    const finish = () => {
      setDrawerOpen(false);
      setDrawerClosing(false);
      // Focus goes back where it came from — without this it falls to <body>
      // and a keyboard user starts over from the top of the page.
      drawerReturnFocusRef.current?.focus();
    };

    // Under prefers-reduced-motion the transition is already flattened to
    // 0.01ms, so waiting out the exit would leave a full-screen scrim
    // intercepting pointer input and focus trapped in an invisible dialog for
    // 230ms — closing would feel broken for exactly the users who asked for
    // less motion. Tear down immediately for them.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }

    setDrawerClosing(true);
    window.setTimeout(finish, 230);
  }, []);

  // Dialog behaviour while open: focus moves in, Escape closes, Tab cycles
  // inside. The primary navigation on mobile could not previously be
  // dismissed or even reached from the keyboard, and focus stayed behind
  // the scrim.
  useEffect(() => {
    if (!drawerOpen) {
      setDrawerEntered(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDrawerEntered(true));
    });
    drawerReturnFocusRef.current = document.activeElement as HTMLElement | null;
    // The close button is the dialog's first focusable element (the scrim is
    // tabIndex -1), so focusing it is "focus moves into the dialog".
    drawerRef.current
      ?.querySelector<HTMLElement>('button:not([tabindex="-1"])')
      ?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDrawer, drawerOpen]);
  const area = useAppStore((state) => state.area);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);
  const setArea = useAppStore((state) => state.setArea);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setGrowthView = useAppStore((state) => state.setGrowthView);
  const viewer = useAppStore((state) => state.viewer);
  const isContributor = viewer.kind === 'contributor';
  // A contributor's world is the matrix and the SAMB project list. COSMETIC
  // ONLY: RLS is what makes GROWTH and the rest unreachable — this nav merely
  // stops offering doors that open onto provably empty rooms. No workspace
  // switch either; there is no second workspace for them.
  const labView = useAppStore((state) => state.labView);
  const setLabView = useAppStore((state) => state.setLabView);
  const nav = isContributor
    ? workNav.filter((item) => item.id === 'finish-line' || item.id === 'projects')
    : area === 'work'
      ? workNav
      : area === 'growth'
        ? growthNav
        : labNav;
  const activeView = area === 'work' ? workView : area === 'growth' ? growthView : labView;

  const signOut = async () => {
    await signOutCollaborator();
    window.location.reload();
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeView, area]);

  const selectNav = (id: WorkView | GrowthView | LabView) => {
    if (area === 'work') setWorkView(id as WorkView);
    else if (area === 'growth') setGrowthView(id as GrowthView);
    else setLabView(id as LabView);
    if (drawerOpen) closeDrawer();
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border-subtle bg-card p-5 lg:flex lg:flex-col">
        <div className="mb-8 flex items-center gap-3">
          {/* The photograph fills the tile rather than sitting inside it as a
              20px mark did: at 40px the figure, the raised arms and the
              lantern all read, and shrinking it back to 20px is exactly the
              size at which they stop. The tile is the mask — the PNG has no
              alpha, so without the clipped radius its square corners read as
              an unstyled asset on the light card.
              The fallback mark keeps `w-5` and the width-only sizing it always
              had: it is wider than tall, so a square utility would shrink it. */}
          <div className="grid size-10 place-items-center overflow-hidden rounded-md border border-border bg-surface-2">
            <LanternPhoto
              size={40}
              alt={LANTERN_ALT}
              className="size-full object-cover"
              markClassName="w-5"
            />
          </div>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">Personal OS</p>
            <p className="surface-label mt-0.5">Daily command</p>
          </div>
        </div>
        {!isContributor && <WorkspaceSwitch area={area} onChange={setArea} />}
        <nav className="mt-7 space-y-1" aria-label={`${area} navigation`}>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => selectNav(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
                className={cn(
                  'flex h-11 w-full items-center gap-3 rounded-sm border-l-2 px-4 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  activeView === item.id
                    ? 'border-primary bg-surface-2 text-foreground'
                    : 'border-transparent text-foreground-muted hover:bg-surface-2 hover:text-foreground-secondary',
                )}
              >
                <Icon className="size-4" />
                {item.label}
                {activeView === item.id && (
                  <ChevronRight className="ml-auto size-4 text-foreground-muted" />
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-border-subtle pt-5 text-xs leading-5 text-foreground-muted">
          {isContributor ? (
            <>
              <p className="flex items-center gap-2 text-foreground-secondary">
                <LayoutDashboard className="size-3.5" />
                Kolaborator
              </p>
              <p className="mt-1 break-words">
                {viewer.email ?? viewer.userId}
                <span className="block">
                  Entitas: {viewer.entityCodes.join(', ')}
                </span>
              </p>
              <Button variant="secondary" className="mt-3 w-full" onClick={() => void signOut()}>
                <Lock className="size-4" />
                Keluar
              </Button>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-foreground-secondary">
                <LayoutDashboard className="size-3.5" />
                {isSupabaseConfigured ? 'Live (Supabase)' : 'Local prototype'}
              </p>
              <p className="mt-1">
                {isSupabaseConfigured
                  ? 'Private by design. Synced to cloud.'
                  : 'Private by design. Mock data only.'}
              </p>
              {isSupabaseConfigured && (
                <Button variant="secondary" className="mt-3 w-full" onClick={lockApp}>
                  <Lock className="size-4" />
                  Lock
                </Button>
              )}
            </>
          )}
          <BuildStamp />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border-subtle bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          {/* 28px, not the 20px the mark used. The header is 56px tall, so the
              room was already there, and 20px is below the size at which the
              photograph resolves into a figure and a lantern — it reads as a
              murky square instead. The mark, which is legible at 20px, keeps
              that size when it stands in. */}
          <div className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-sm">
            <LanternPhoto
              size={28}
              alt={LANTERN_ALT}
              className="size-full object-cover"
              markClassName="w-5"
            />
          </div>
          <span className="font-display text-sm font-semibold">Personal OS</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* The scrim is a real control now — it was an onClick on a plain
              div, invisible to the keyboard and the accessibility tree.
              tabIndex -1 keeps it clickable without adding a second tab stop;
              Escape and the close button are the keyboard paths. True black
              is reserved for scrims, per the token layer. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={closeDrawer}
            data-state={drawerClosing ? 'closing' : drawerEntered ? 'open' : 'closed'}
            className="drawer-scrim absolute inset-0 h-full w-full bg-black/75"
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            data-state={drawerClosing ? 'closing' : drawerEntered ? 'open' : 'closed'}
            className="drawer-panel relative ml-auto flex h-full w-[min(88vw,360px)] flex-col overflow-y-auto border-l border-border-subtle bg-card p-5"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-base font-semibold">Navigate</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeDrawer}
                aria-label="Close navigation"
              >
                <X className="size-5" />
              </Button>
            </div>
            {!isContributor && (
              <WorkspaceSwitch
                area={area}
                onChange={(next) => {
                  setArea(next);
                }}
              />
            )}
            <nav className="mt-6 space-y-1.5">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectNav(item.id)}
                    className={cn(
                      'flex min-h-12 w-full items-center gap-3 rounded-sm border border-border-subtle px-4 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      activeView === item.id && 'border-l-2 border-l-primary bg-surface-2 text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* app-main only declares `container-type: inline-size` so a canvas
          inside can measure THIS column — the viewport minus the fixed
          sidebar — with 100cqi. Nothing else reads it, and it changes no
          layout of its own. Safe because nothing inside <main> is
          position: fixed (the toast viewport mounts in main.tsx, beside
          <App/>), so the containment this implies has nothing to capture. */}
      <main className="app-main pb-24 lg:ml-64 lg:pb-0">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-border-subtle bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
        aria-label={`${area} quick navigation`}
      >
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => selectNav(item.id)}
              aria-current={activeView === item.id ? 'page' : undefined}
              className={cn(
                'flex min-h-[56px] min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-sm px-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeView === item.id ? 'bg-surface-2 text-foreground' : 'text-foreground-muted',
              )}
            >
              <Icon className={cn('size-5', activeView === item.id && 'text-foreground-secondary')} />
              {item.short}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
