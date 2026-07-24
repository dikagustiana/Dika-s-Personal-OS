import { AppShell } from './layout/AppShell';
import { useAppStore } from './store/appStore';
import { Analytics } from './views/growth/Analytics';
import { Escalations } from './views/growth/Escalations';
import { Projects } from './views/growth/Projects';
import { Timebox } from './views/work/Timebox';
import { Today } from './views/work/Today';
import { Week } from './views/work/Week';

export default function App() {
  const workspace = useAppStore((state) => state.workspace);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);

  // Both workspaces carry the full view set; Escalations exists in WORK only.
  const activeView = workspace === 'work' ? workView : growthView;

  // key={workspace} remounts the view when switching worlds so no local
  // state (drafts, selected dates) leaks from one domain into the other.
  let view: React.ReactNode;
  if (activeView === 'timebox') view = <Timebox key={workspace} />;
  else if (activeView === 'week') view = <Week key={workspace} />;
  else if (activeView === 'projects') view = <Projects key={workspace} />;
  else if (activeView === 'analytics') view = <Analytics key={workspace} />;
  else if (activeView === 'escalations' && workspace === 'work') view = <Escalations key={workspace} />;
  else view = <Today key={workspace} />;

  return <AppShell>{view}</AppShell>;
}
