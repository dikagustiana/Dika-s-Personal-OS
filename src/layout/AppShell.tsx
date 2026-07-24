import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock3,
  Focus,
  LayoutDashboard,
  Megaphone,
  Menu,
  Mountain,
  Target,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { isSupabaseConfigured } from '../data/supabaseRepository';
import { cn } from '../lib/utils';
import {
  useAppStore,
  type GrowthView,
  type WorkView,
  type Workspace,
} from '../store/appStore';
import { Button } from '../components/ui/Button';

const workNav: Array<{ id: WorkView; label: string; icon: typeof Focus }> = [
  { id: 'today', label: 'Today', icon: Focus },
  { id: 'timebox', label: 'Timebox', icon: Clock3 },
  { id: 'week', label: 'Week', icon: CalendarDays },
];

const growthNav: Array<{ id: GrowthView; label: string; icon: typeof Focus }> = [
  { id: 'projects', label: 'Projects', icon: Target },
  { id: 'escalations', label: 'Escalations', icon: Megaphone },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

function WorkspaceSwitch({
  workspace,
  onChange,
}: {
  workspace: Workspace;
  onChange: (workspace: Workspace) => void;
}) {
  return (
    <div className="grid grid-cols-2 border border-gray-800 bg-black/20 p-1">
      {(['work', 'growth'] as const).map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={cn(
            'min-h-11 rounded-sm px-3 text-xs font-bold uppercase tracking-[0.16em] transition-colors',
            workspace === item ? 'bg-primary text-white' : 'text-gray-500 hover:text-gray-200',
          )}
        >
          {item}
        </button>
      ))}
    </div>
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-gray-800 bg-[#0d100e] p-5 lg:flex lg:flex-col">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid size-10 place-items-center border border-primary/50 bg-primary/10">
            <Mountain className="size-5 text-primary" />
          </div>
          <div>
            <p className="font-bold tracking-tight">PERSONAL OS</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-gray-600">Daily command</p>
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
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 border-l-2 px-4 text-sm transition-colors',
                  activeView === item.id
                    ? 'border-primary bg-primary/10 text-white'
                    : 'border-transparent text-gray-500 hover:bg-muted hover:text-gray-200',
                )}
              >
                <Icon className="size-4" />
                {item.label}
                {activeView === item.id && <ChevronRight className="ml-auto size-4 text-primary" />}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-gray-800 pt-5 text-xs leading-5 text-gray-600">
          <p className="flex items-center gap-2 text-gray-400">
            <LayoutDashboard className="size-3.5" />
            {isSupabaseConfigured ? 'Live (Supabase)' : 'Local prototype'}
          </p>
          <p className="mt-1">
            {isSupabaseConfigured
              ? 'Private by design. Synced to cloud.'
              : 'Private by design. Mock data only.'}
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-800 bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <Mountain className="size-5 text-primary" />
          <span className="text-sm font-bold tracking-wide">PERSONAL OS</span>
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
            className="ml-auto flex h-full w-[min(88vw,360px)] flex-col border-l border-gray-800 bg-[#0d100e] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="font-bold">Navigate</span>
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
            <nav className="mt-6 space-y-2">
              {(workspace === 'work' ? workNav : growthNav).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectNav(item.id)}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 border border-gray-800 px-4 text-left',
                      activeView === item.id && 'border-primary bg-primary/10 text-white',
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
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-gray-800 bg-[#0d100e]/98 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        aria-label={`${workspace} quick navigation`}
      >
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => selectNav(item.id)}
              className={cn(
                'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-sm text-[11px] font-semibold',
                activeView === item.id ? 'bg-primary/15 text-white' : 'text-gray-500',
              )}
            >
              <Icon className={cn('size-5', activeView === item.id && 'text-primary')} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
