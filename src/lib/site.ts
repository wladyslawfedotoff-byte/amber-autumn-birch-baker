/**
 * The app's display name and tagline — ONE place: src/lib/og/site.json.
 * Renaming «Пора» = change `title` there (and `tagline` / `description`);
 * the login page, the sidebar, <title>, the PWA manifest and the share card
 * all read it from here.
 */
import site from "./og/site.json" with { type: "json" };

export const APP_NAME: string = site.title;
export const APP_TAGLINE: string = site.tagline;
/** «Пора — время делать» */
export const APP_TITLE: string = APP_TAGLINE ? `${APP_NAME} — ${APP_TAGLINE}` : APP_NAME;
export const APP_DESCRIPTION: string = site.description;
