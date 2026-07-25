import { AppShell } from './layout/AppShell';
import { useAppStore } from './store/appStore';
import { Dashboard } from './views/work/Dashboard';
import { FinishLine } from './views/work/FinishLine';
import { Today } from './views/work/Today';
import { Week } from './views/work/Week';
import { Projects } from './views/growth/Projects';
import { MonthlyClose } from './views/work/MonthlyClose';
import { Escalations } from './views/growth/Escalations';
import { GrowthDashboard } from './views/growth/GrowthDashboard';
import { Ielts } from './views/growth/Ielts';
import { Initiative } from './views/growth/Initiative';

export default function App() {
  const workspace = useAppStore((state) => state.workspace);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);

  // key={workspace} remounts the view when switching worlds so no local state
  // (drafts, selected dates) leaks from one domain into the other.
  let view: React.ReactNode;
  if (workspace === 'work') {
    if (workView === 'today') view = <Today key="work" />;
    else if (workView === 'week') view = <Week key="work" />;
    else if (workView === 'projects') view = <Projects key="work" />;
    else if (workView === 'finish-line') view = <FinishLine />;
    else if (workView === 'monthly-close') view = <MonthlyClose />;
    else if (workView === 'escalations') view = <Escalations />;
    else view = <Dashboard />;
  } else {
    if (growthView === 'ielts') view = <Ielts />;
    else if (growthView === 'uni') view = <Initiative key="uni" initiative="uni" />;
    else if (growthView === 'chevening') view = <Initiative key="chevening" initiative="chevening" />;
    else if (growthView === 'lpdp') view = <Initiative key="lpdp" initiative="lpdp" />;
    else if (growthView === 'research') view = <Initiative key="research" initiative="research" />;
    else if (growthView === 'website') view = <Initiative key="website" initiative="website" />;
    else view = <GrowthDashboard />;
  }

  return <AppShell>{view}</AppShell>;
}
