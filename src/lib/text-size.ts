/**
 * «Размер текста» from iOS (Dynamic Type), 1.18. Safari exposes the user's
 * size through `font: -apple-system-body` (17px at the default setting). The
 * app keeps its 16px root at the default and scales every rem with the
 * setting, capped so the dense layout does not break at the accessibility sizes.
 */
export const BODY_DEFAULT = 17;
export const ROOT_MIN = 14;
export const ROOT_MAX = 22;

/** Root font size (px) for a given iOS body size (px). */
export function rootSizeFor(body: number): number {
  if (!(body > 0)) return 16;
  const px = (16 * body) / BODY_DEFAULT;
  return Math.round(Math.min(ROOT_MAX, Math.max(ROOT_MIN, px)) * 4) / 4;
}

/** Inline, before first paint (no jump). Re-checked when the app comes back from the background. */
export const TEXT_SIZE_SCRIPT = `(function(){try{if(!window.CSS||!CSS.supports("font","-apple-system-body"))return;var d=document.documentElement;function f(){var e=document.createElement("span");e.style.cssText="font:-apple-system-body;position:absolute;visibility:hidden";d.appendChild(e);var b=parseFloat(getComputedStyle(e).fontSize);e.remove();var p=b>0?Math.round(Math.min(${ROOT_MAX},Math.max(${ROOT_MIN},16*b/${BODY_DEFAULT}))*4)/4:16;d.style.fontSize=p===16?"":p+"px"}f();document.addEventListener("visibilitychange",function(){if(!document.hidden)f()})}catch(e){}})();`;
