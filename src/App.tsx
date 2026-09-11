import { Suspense, lazy, useEffect } from 'react';
import { AppShell } from './layout/AppShell';
import { useAppStore } from './store/appStore';
import { AccessDashboard } from './views/work/AccessDashboard';
import { Dashboard } from './views/work/Dashboard';
import { FinishLineArea } from './views/work/FinishLineArea';
import { isFinishLinePath } from './views/work/finishLineRoute';
import { Today } from './views/work/Today';
import { Week } from './views/work/Week';
import { Projects } from './views/growth/Projects';
import { MonthlyClose } from './views/work/MonthlyClose';
import { Escalations } from './views/growth/Escalations';
import { GrowthDashboard } from './views/growth/GrowthDashboard';
import { IeltsArea } from './views/growth/ielts/IeltsArea';
import { Initiative } from './views/growth/Initiative';
import { ResearchArea } from './views/growth/research/ResearchArea';
import { LabRegistry } from './views/lab/LabRegistry';
import { LabRun } from './views/lab/LabRun';
import { LabRuns } from './views/lab/LabRuns';
import { LabChains } from './views/lab/LabChains';
import { LabFlow } from './views/lab/flow/LabFlow';
import { LabEvidence } from './views/lab/evidence/LabEvidence';
import { InstitutionDirector } from './views/lab/institution/InstitutionDirector';

/**
 * B-11: the floor is the ONLY lazy view in the app, and it is lazy for one
 * measured reason — it pulls three.js, drei and the postprocessing stack,
 * which together are larger than the rest of the bundle. Every other view
 * is small enough that a second request costs more than it saves. The
 * bundle report in PROGRESS.md is the proof that this boundary holds; a
 * static import added anywhere in src/ that reaches this tree would put
 * Three back in the main chunk without any error to notice.
 */
const LabFloor = lazy(() =>
  import('./views/lab/floor/hud/OfficeApp').then((module) => ({ default: module.OfficeApp })),
);

export default function App() {
  const workspace = useAppStore((state) => state.workspace);
  const area = useAppStore((state) => state.area);
  const workView = useAppStore((state) => state.workView);
  const growthView = useAppStore((state) => state.growthView);
  const labView = useAppStore((state) => state.labView);

  // The Finish line owns the only address in the app; every other view is
  // state with no URL. Leaving it therefore has to put the address back,
  // or a Dashboard would sit under a /finish-line/swimlane URL and a reload
  // would land somewhere the reader did not leave. replaceState, not push:
  // sidebar navigation is not history in this app.
  useEffect(() => {
    // `area`, not `workspace`: entering the lab leaves `workspace` at its
    // last value, and a Finish line URL must not survive into the lab.
    if (area === 'work' && workView === 'finish-line') return;
    if (isFinishLinePath(window.location.pathname)) {
      window.history.replaceState(null, '', '/');
    }
  }, [area, workView]);

  // key={workspace} remounts the view when switching worlds so no local state
  // (drafts, selected dates) leaks from one domain into the other.
  let view: React.ReactNode;
  if (area === 'lab') {
    if (labView === 'run') view = <LabRun key="lab" />;
    else if (labView === 'runs') view = <LabRuns key="lab" />;
    else if (labView === 'chains') view = <LabChains key="lab" />;
    else if (labView === 'flow') view = <LabFlow key="lab" />;
    else if (labView === 'evidence') view = <LabEvidence key="lab" />;
    else if (labView === 'institution') view = <InstitutionDirector key="lab" />;
    else if (labView === 'floor') {
      view = (
        <Suspense
          key="lab"
          fallback={<p className="p-6 text-sm text-foreground-muted">Loading the floor…</p>}
        >
          <LabFloor />
        </Suspense>
      );
    }
    else view = <LabRegistry key="lab" />;
  } else if (workspace === 'work') {
    if (workView === 'today') view = <Today key="work" />;
    else if (workView === 'week') view = <Week key="work" />;
    else if (workView === 'projects') view = <Projects key="work" />;
    else if (workView === 'finish-line') view = <FinishLineArea />;
    else if (workView === 'access') view = <AccessDashboard />;
    else if (workView === 'monthly-close') view = <MonthlyClose />;
    else if (workView === 'escalations') view = <Escalations />;
    else view = <Dashboard />;
  } else {
    if (growthView === 'ielts') view = <IeltsArea />;
    else if (growthView === 'uni') view = <Initiative key="uni" initiative="uni" />;
    else if (growthView === 'chevening') view = <Initiative key="chevening" initiative="chevening" />;
    else if (growthView === 'lpdp') view = <Initiative key="lpdp" initiative="lpdp" />;
    // Research does not use the generic initiative page: the pipeline is the
    // content, and a project card cannot carry gates, a register or a log.
    else if (growthView === 'research') view = <ResearchArea key="research" />;
    else if (growthView === 'website') view = <Initiative key="website" initiative="website" />;
    else if (growthView === 'projects') view = <Projects key="growth" />;
    else view = <GrowthDashboard />;
  }

  return <AppShell>{view}</AppShell>;
}
