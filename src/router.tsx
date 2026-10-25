import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { watchStaleChunks } from "@/lib/offline/stale-chunks";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // 1.17: an old open page reloads onto a new version instead of failing on a missing file.
  if (typeof window !== "undefined") watchStaleChunks();
  return createRouter({ routeTree, defaultErrorComponent: AppErrorComponent });
}
