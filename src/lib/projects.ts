import type { Project } from "./planner-types.ts";

/** Cards on the last stage count as done («Готово» is usually the last column). */
export function projectProgress(project: Project): { done: number; total: number } {
  const total = project.stages.reduce((sum, stage) => sum + stage.cards.length, 0);
  const last = project.stages[project.stages.length - 1];
  const done = last && project.stages.length > 1 ? last.cards.length : 0;
  return { done, total };
}
