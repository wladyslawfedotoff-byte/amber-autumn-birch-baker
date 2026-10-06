import { usePlanner } from "@/lib/planner-store";
import type { ShareScope } from "@/lib/queries";
import { useProfile } from "@/lib/use-capabilities";

/** Share scope for queries («Общие»); undefined with one profile. */
export function useShareScope(): ShareScope | undefined {
  const profile = useProfile();
  const lists = usePlanner((s) => s.lists);
  if (!profile.multiUser || !profile.login) return undefined;
  return { lists, me: profile.login, dataOwner: profile.dataOwner || profile.login };
}
