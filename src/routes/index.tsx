import { createFileRoute } from "@tanstack/react-router";
import { PlannerApp } from "@/components/planner/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PlannerApp />;
}
