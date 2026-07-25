import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  MoonStar,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, getDay, getHours, parseISO, subDays } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { Input } from '../../components/ui/Input';
import type { Project, WeeklyGoal, WeeklyPlan } from '../../data/types';
import {
  formatWeekLabel,
  getIsoWeekKey,
  getNextWeekKey,
  getPreviousWeekKey,
  getReviewTargetWeek,
  getWeekRange,
  summarizeWeek,
  type WeekSummary,
} from '../../logic/week';
import { useMutation } from '../../hooks/useMutation';
import { useAppStore } from '../../store/appStore';

function emptyGoals(): WeeklyGoal[] {
  return Array.from({ length: 3 }, () => ({
    id: crypto.randomUUID(),
    text: '',
    done: false,
  }));
}

export function Week() {
  const repository = useAppStore((state) => state.repository);
  const { run, isPending } = useMutation();
  const domain = useAppStore((state) => state.workspace);
  const now = new Date();
  const currentWeek = getIsoWeekKey(now);
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [plan, setPlan] = useState<WeeklyPlan>({
    week: currentWeek,
    domain,
    goals: emptyGoals(),
  });
  const [reviewedPlan, setReviewedPlan] = useState<WeeklyPlan | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<WeekSummary>({
    averageScore: 0,
    habitConsistency: 0,
    daysLogged: 0,
    goalsHit: [],
    goalsMissed: [],
  });
  const [saved, setSaved] = useState(false);

  const isSundayEvening = getDay(now) === 0 && getHours(now) >= 18;
  // The week the review card summarizes — and the week its `reviewedAt`
  // belongs to. Never the week being planned on screen.
  const previousWeek = getReviewTargetWeek(selectedWeek);

  const load = useCallback(async () => {
    const previousRange = getWeekRange(previousWeek);
    const [selectedPlan, previousPlan, previousLogs, projectData] = await Promise.all([
      repository.getWeeklyPlan(selectedWeek, domain),
      repository.getWeeklyPlan(previousWeek, domain),
      repository.listDailyLogs({
        from: previousRange.from,
        to: format(subDays(parseISO(previousRange.to), 1), 'yyyy-MM-dd'),
        domain,
      }),
      repository.listProjects(domain),
    ]);
    setPlan(selectedPlan ?? { week: selectedWeek, domain, goals: emptyGoals() });
    setReviewedPlan(previousPlan);
    setSummary(summarizeWeek(previousLogs, previousPlan));
    setProjects(projectData);
    setSaved(false);
  }, [domain, previousWeek, repository, selectedWeek]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateGoal = (id: string, patch: Partial<WeeklyGoal>) => {
    setPlan((current) => ({
      ...current,
      goals: current.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)),
    }));
    setSaved(false);
  };

  const savePlan = async () => {
    const cleaned: WeeklyPlan = {
      ...plan,
      week: selectedWeek,
      domain,
      theme: plan.theme?.trim() || undefined,
      goals: plan.goals
        .map((goal) => ({ ...goal, text: goal.text.trim() }))
        .filter((goal) => goal.text.length > 0),
    };
    const savedPlan = await run('Save weekly plan', () =>
      repository.upsertWeeklyPlan(cleaned),
    );
    if (!savedPlan) return;
    setPlan(savedPlan);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const addGoal = () => {
    if (plan.goals.length >= 5) return;
    setPlan((current) => ({
      ...current,
      goals: [
        ...current.goals,
        { id: crypto.randomUUID(), text: '', done: false },
      ],
    }));
  };

  const removeGoal = (id: string) => {
    if (plan.goals.length <= 3) return;
    setPlan((current) => ({
      ...current,
      goals: current.goals.filter((goal) => goal.id !== id),
    }));
  };

  /**
   * Closes out `previousWeek` — the week the summary above describes. It is
   * deliberately independent of the plan being edited on screen: the two are
   * different weeks, and conflating them is what let the current week show as
   * reviewed while the reviewed week stayed open.
   */
  const completeReview = async () => {
    const reviewedAt = new Date().toISOString();
    const target: WeeklyPlan = reviewedPlan ?? {
      week: previousWeek,
      domain,
      goals: [],
    };
    const savedPlan = await run('Complete review', () =>
      repository.upsertWeeklyPlan({ ...target, week: previousWeek, domain, reviewedAt }),
    );
    if (!savedPlan) return;
    setReviewedPlan(savedPlan);
  };

  const completion = useMemo(() => {
    const filled = plan.goals.filter((goal) => goal.text.trim());
    return {
      done: filled.filter((goal) => goal.done).length,
      total: filled.length,
    };
  }, [plan.goals]);
  const canSave = plan.goals.filter((goal) => goal.text.trim()).length >= 3;

  return (
    <div className="page-shell">
      <header className="mb-7 border-b border-border-subtle pb-7 md:flex md:items-end md:justify-between">
        <div>
          <p className="page-kicker">{domain} / Week</p>
          <h1 className="page-title">Direct the week</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-muted">
            Choose outcomes, trace them upward, and close the loop before the next week begins.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-2 md:mt-0">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setSelectedWeek(getPreviousWeekKey(selectedWeek))}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="grid min-h-11 min-w-40 place-items-center border border-border-subtle bg-muted px-3 text-sm font-semibold">
            {formatWeekLabel(selectedWeek)}
          </div>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setSelectedWeek(getNextWeekKey(selectedWeek))}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      {isSundayEvening && selectedWeek === currentWeek && (
        <div className="mb-5 flex flex-col gap-4 rounded-lg border border-border bg-surface-2/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <MoonStar className="mt-0.5 size-5 shrink-0 text-foreground-muted" />
            <div>
              <p className="font-semibold text-foreground">Time to plan next week</p>
              <p className="mt-1 text-sm text-foreground-muted">A quiet ten-minute reset is enough.</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setSelectedWeek(getNextWeekKey(currentWeek))}>
            Plan next week
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.75fr)]">
        <Card>
          <CardHeader className="border-b border-border-subtle">
            <div>
              <CardTitle>Weekly plan</CardTitle>
              <p className="mt-2 text-sm text-foreground-muted">
                {completion.done}/{completion.total} outcomes complete
              </p>
            </div>
            <CalendarCheck2 className="size-5 text-primary" />
          </CardHeader>
          <CardContent className="pt-5">
            <label className="block">
              <span className="surface-label">Theme</span>
              <Input
                value={plan.theme ?? ''}
                onChange={(event) => {
                  setPlan((current) => ({ ...current, theme: event.target.value }));
                  setSaved(false);
                }}
                placeholder="One line to guide the week"
                className="mt-2"
              />
            </label>

            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="surface-label">Outcomes · 3–5</span>
                <span className="text-xs tabular-nums text-foreground-muted">{plan.goals.length}/5</span>
              </div>
              {plan.goals.map((goal, index) => (
                <div key={goal.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border border-border-subtle bg-surface-2 p-2">
                  <Checkbox
                    checked={goal.done}
                    onCheckedChange={(checked) => updateGoal(goal.id, { done: checked === true })}
                    aria-label={`Toggle weekly goal ${index + 1}`}
                  />
                  <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(170px,0.45fr)]">
                    <Input
                      value={goal.text}
                      onChange={(event) => updateGoal(goal.id, { text: event.target.value })}
                      placeholder={`Outcome ${index + 1}`}
                      className={goal.done ? 'text-foreground-muted line-through' : ''}
                    />
                    <select
                      className="native-select"
                      value={goal.projectId ?? ''}
                      onChange={(event) =>
                        updateGoal(goal.id, { projectId: event.target.value || undefined })
                      }
                      aria-label={`Project link for goal ${index + 1}`}
                    >
                      <option value="">No project link</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="danger"
                    size="icon"
                    disabled={plan.goals.length <= 3}
                    onClick={() => removeGoal(goal.id)}
                    aria-label={`Remove goal ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="secondary"
                onClick={addGoal}
                disabled={plan.goals.length >= 5}
              >
                <Plus className="size-4" />
                Add outcome
              </Button>
              <Button onClick={() => void savePlan()} disabled={!canSave}>
                {saved ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}
                {saved ? 'Saved' : 'Save plan'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="border-b border-border-subtle">
            <div>
              <CardTitle>Sunday review</CardTitle>
              <p className="mt-2 text-xs text-foreground-muted">{previousWeek} summary</p>
            </div>
            {reviewedPlan?.reviewedAt ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : (
              <Circle className="size-5 text-foreground-muted" />
            )}
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-border-subtle bg-surface-2">
              <div className="bg-card p-4">
                <p className="text-3xl font-bold tabular-nums">{summary.averageScore}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-foreground-muted">Avg score</p>
              </div>
              <div className="bg-card p-4">
                <p className="text-3xl font-bold tabular-nums">{summary.habitConsistency}%</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-foreground-muted">Habit consistency</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-foreground-muted">{summary.daysLogged} days logged</p>

            <div className="mt-6">
              <p className="surface-label">Goals hit</p>
              <ul className="mt-3 space-y-2">
                {summary.goalsHit.map((goal) => (
                  <li key={goal} className="flex gap-2 text-sm text-foreground-secondary">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    {goal}
                  </li>
                ))}
                {summary.goalsHit.length === 0 && (
                  <li className="text-sm text-foreground-muted">No completed goals recorded.</li>
                )}
              </ul>
            </div>

            <div className="mt-5">
              <p className="surface-label">Goals missed</p>
              <ul className="mt-3 space-y-2">
                {summary.goalsMissed.map((goal) => (
                  <li key={goal} className="flex gap-2 text-sm text-foreground-muted">
                    <Circle className="mt-0.5 size-4 shrink-0" />
                    {goal}
                  </li>
                ))}
                {summary.goalsMissed.length === 0 && (
                  <li className="text-sm text-foreground-muted">Nothing marked missed.</li>
                )}
              </ul>
            </div>

            <Button
              className="mt-6 w-full"
              variant={reviewedPlan?.reviewedAt ? 'secondary' : 'default'}
              onClick={() => void completeReview()}
              disabled={isPending}
            >
              <CalendarCheck2 className="size-4" />
              {reviewedPlan?.reviewedAt ? 'Review completed' : 'Complete review'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
