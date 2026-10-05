import { daysBetween, shiftIso } from "@/lib/dates";
import type { Project, ProjectStage } from "@/lib/planner-types";

/** Where a stage sits on the calendar. Explicit dates win; otherwise the project is split evenly. */
export function stageRange(
  project: Project,
  stage: ProjectStage,
  index: number,
): { start: string; end: string } | null {
  if (stage.start && stage.end && stage.end >= stage.start) {
    return { start: stage.start, end: stage.end };
  }
  if (!project.start || !project.end || project.end < project.start) return null;
  const count = Math.max(project.stages.length, 1);
  const total = daysBetween(project.start, project.end) + 1;
  const span = Math.max(1, Math.floor(total / count));
  const offset = Math.min(index * span, Math.max(0, total - 1));
  const start = shiftIso(project.start, offset);
  const end =
    index === count - 1 ? project.end : shiftIso(project.start, Math.min(offset + span - 1, total - 1));
  return { start, end: end < start ? start : end };
}
