import {
  CalendarCheck,
  CalendarDays,
  Clock,
  Columns3,
  Hourglass,
  Inbox,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Repeat,
  Settings,
  Timer,
} from "lucide-react";
import type { TabId } from "@/lib/ui-prefs";

/** Same icons as in the side menu. */
export const TAB_ICONS: Record<TabId, typeof Inbox> = {
  today: CalendarCheck,
  calendar: CalendarDays,
  schedule: Clock,
  habits: Repeat,
  focus: Timer,
  matrix: LayoutGrid,
  dates: Hourglass,
  checklist: ListChecks,
  inbox: Inbox,
  projects: Columns3,
  assist: MessageSquare,
  settings: Settings,
};
