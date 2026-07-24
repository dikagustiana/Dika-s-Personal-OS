export interface CompletionComponent {
  completed: number;
  total: number;
}

export interface DailyScoreInput {
  habits: CompletionComponent;
  tasks: CompletionComponent;
  timeblocks: CompletionComponent;
}

export interface DailyScoreResult {
  score: number;
  isEmpty: boolean;
  activeComponents: number;
}

const COMPONENTS = [
  { key: 'habits', weight: 0.4 },
  { key: 'tasks', weight: 0.4 },
  { key: 'timeblocks', weight: 0.2 },
] as const;

export function calculateDailyScore(input: DailyScoreInput): DailyScoreResult {
  const active = COMPONENTS.filter(({ key }) => input[key].total > 0);

  if (active.length === 0) {
    return { score: 0, isEmpty: true, activeComponents: 0 };
  }

  const activeWeightSum = active.reduce((sum, component) => sum + component.weight, 0);
  const weightedCompletion = active.reduce((sum, { key, weight }) => {
    const { completed, total } = input[key];
    const safeCompleted = Math.min(Math.max(completed, 0), total);
    return sum + weight * (safeCompleted / total);
  }, 0);

  return {
    score: Math.round((100 * weightedCompletion) / activeWeightSum),
    isEmpty: false,
    activeComponents: active.length,
  };
}
