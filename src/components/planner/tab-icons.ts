import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Clock,
  Hash,
  List,
  Pin,
  Columns3,
  Hourglass,
  Inbox,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Repeat,
  Settings,
  Sunrise,
  Users,
  Timer,
} from "lucide-react";
import type { NavId, TabId } from "@/lib/ui-prefs";

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
  tomorrow: Sunrise,
  week: CalendarRange,
  shared: Users,
  settings: Settings,
};

/** «Навигация» rows: the tab icons plus the drawer groups. */
export const NAV_ICONS: Record<NavId, typeof Inbox> = {
  ...TAB_ICONS,
  lists: List,
  tags: Hash,
  pinned: Pin,
};
