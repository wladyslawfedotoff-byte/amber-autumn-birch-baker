import assert from "node:assert/strict";
import test from "node:test";
import { closeAllPopovers, isInside, setPopover, usePopoverStore } from "./popover.ts";

test("only one popover is open at a time", () => {
  setPopover("bell", true);
  assert.equal(usePopoverStore.getState().id, "bell");
  setPopover("calendar-mode", true);
  assert.equal(usePopoverStore.getState().id, "calendar-mode");
  setPopover("bell", false); // closing a popover that is not open changes nothing
  assert.equal(usePopoverStore.getState().id, "calendar-mode");
  setPopover("calendar-mode", false);
  assert.equal(usePopoverStore.getState().id, null);
});

test("closeAllPopovers closes whatever is open", () => {
  setPopover("bell", true);
  closeAllPopovers();
  assert.equal(usePopoverStore.getState().id, null);
});

test("isInside", () => {
  const child = { nodeType: 1 };
  const root = { contains: (n: unknown) => n === child } as unknown as Element;
  assert.equal(isInside(child as unknown as EventTarget, [root]), true);
  assert.equal(isInside({ nodeType: 1 } as unknown as EventTarget, [root, null]), false);
  assert.equal(isInside(null, [root]), false);
});
