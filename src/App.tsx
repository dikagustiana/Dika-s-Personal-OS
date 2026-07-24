import { AppShell } from './layout/AppShell';
import { useAppStore } from './store/appStore';
import { Analytics } from './views/growth/Analytics';
import { Projects } from './views/growth/Projects';
import { Timebox } from './views/work/Timebox';
import { Today } from './views/work/Today';
import { Week } from './views/work/Week';

export default function App() {
  const workspace = useAppStore((state) => state.workspace);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);

  let view: React.ReactNode;
  if (workspace === 'work') {
    if (workView === 'timebox') view = <Timebox />;
    else if (workView === 'week') view = <Week />;
    else view = <Today />;
  } else {
    view = growthView === 'analytics' ? <Analytics /> : <Projects />;
  }

  return <AppShell>{view}</AppShell>;
}
