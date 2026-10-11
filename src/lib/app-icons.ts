/**
 * App icon files (public/icons, public/favicon.*). The version query makes
 * browsers and the iOS home screen pick up a new icon after an update.
 * Sources: public/icons/icon.svg (full bleed — iOS rounds the corners itself),
 * icon-maskable.svg (artwork inside the safe circle), public/favicon.svg.
 */
export const ICON_VERSION = "1.6.0";

const v = (path: string) => `${path}?v=${ICON_VERSION}`;

export const FAVICON_SVG = v("/favicon.svg");
export const FAVICON_ICO = v("/favicon.ico");
export const MANIFEST_URL = v("/__grok/manifest.webmanifest");
export const APPLE_TOUCH_ICONS = [180, 167, 152, 120].map((size) => ({ size, href: v(`/icons/apple-touch-icon-${size}.png`) }));

/** Splash / install background and the browser bar of the installed app. */
export const ICON_BACKGROUND = "#0f4a6e";
