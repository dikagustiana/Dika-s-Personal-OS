import {
  BookOpen,
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
  RefreshCw,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { isSupabaseConfigured } from '../data/supabaseRepository';
import { lockApp } from '../components/PassphraseGate';
import { cn } from '../lib/utils';
import {
  useAppStore,
  type GrowthView,
  type WorkView,
  type Workspace,
} from '../store/appStore';
import { Button } from '../components/ui/Button';
import { LanternMark } from '../components/ui/LanternMark';

// `short` is the compact label used in the mobile bottom strip.
const workNav: Array<{ id: WorkView; label: string; short: string; icon: typeof Focus }> = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
  { id: 'today', label: 'Today', short: 'Today', icon: Focus },
  { id: 'week', label: 'Week', short: 'Week', icon: CalendarDays },
  { id: 'projects', label: 'Projects', short: 'Projects', icon: Target },
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

function WorkspaceSwitch({
  workspace,
  onChange,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-md border border-border-subtle bg-background p-1">
      {(['work', 'growth'] as const).map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          aria-pressed={workspace === item}
          className={cn(
            'h-9 rounded-sm px-3 text-xs font-semibold uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            workspace === item
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
    <p className="mt-2 font-mono text-[10px] tabular-nums text-foreground-muted">
      {__BUILD_SHA__} · {built} UTC
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const workspace = useAppStore((state) => state.workspace);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);
  const setWorkspace = useAppStore((state) => state.setWorkspace);
  const setWorkView = useAppStore((state) => state.setWorkView);
  const setGrowthView = useAppStore((state) => state.setGrowthView);
  const nav = workspace === 'work' ? workNav : growthNav;
  const activeView = workspace === 'work' ? workView : growthView;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeView, workspace]);

  const selectNav = (id: WorkView | GrowthView) => {
    if (workspace === 'work') setWorkView(id as WorkView);
    else setGrowthView(id as GrowthView);
    setDrawerOpen(false);
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border-subtle bg-card p-5 lg:flex lg:flex-col">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md border border-border bg-surface-2">
            {/* Width only — the mark is wider than tall, so a square size
                utility would shrink it inside the tile. */}
            <LanternMark className="w-5" />
          </div>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">Personal OS</p>
            <p className="surface-label mt-0.5">Daily command</p>
          </div>
        </div>
        <WorkspaceSwitch workspace={workspace} onChange={setWorkspace} />
        <nav className="mt-7 space-y-1" aria-label={`${workspace} navigation`}>
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
          <BuildStamp />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border-subtle bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <LanternMark className="w-5" />
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
        <div className="fixed inset-0 z-50 bg-black/75 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <aside
            className="ml-auto flex h-full w-[min(88vw,360px)] flex-col overflow-y-auto border-l border-border-subtle bg-card p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-base font-semibold">Navigate</span>
              <Button variant="ghost" size="icon" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
                <X className="size-5" />
              </Button>
            </div>
            <WorkspaceSwitch
              workspace={workspace}
              onChange={(next) => {
                setWorkspace(next);
              }}
            />
            <nav className="mt-6 space-y-1.5">
              {(workspace === 'work' ? workNav : growthNav).map((item) => {
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

      <main className="pb-24 lg:ml-64 lg:pb-0">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-border-subtle bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
        aria-label={`${workspace} quick navigation`}
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
