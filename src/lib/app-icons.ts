/**
 * App icon files (public/icons, public/favicon.*). The version query makes
 * browsers and the iOS home screen pick up a new icon after an update.
 * Sources: public/icons/icon.svg (full bleed — iOS rounds the corners itself),
 * icon-maskable.svg (artwork inside the safe circle), public/favicon.svg.
 */
export const ICON_VERSION = "1.18.0";

const v = (path: string) => `${path}?v=${ICON_VERSION}`;

export const FAVICON_SVG = v("/favicon.svg");
export const FAVICON_ICO = v("/favicon.ico");
export const MANIFEST_URL = v("/manifest.webmanifest");
export const APPLE_TOUCH_ICONS = [180, 167, 152, 120].map((size) => ({ size, href: v(`/icons/apple-touch-icon-${size}.png`) }));

/** Splash / install background and the browser bar of the installed app. */
export const ICON_BACKGROUND = "#f6f4ef";

/** iPhone screens (points × scale) that get a launch image: [width, height, scale]. */
export const SPLASH_SIZES: readonly (readonly [number, number, number])[] = [
  [375, 667, 2],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 2],
  [414, 896, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
];

/**
 * Launch screens (1.18): app background with the icon, light and dark.
 * iOS picks the one whose media query matches the device exactly.
 */
export const STARTUP_IMAGES = SPLASH_SIZES.flatMap(([w, h, r]) =>
  (["light", "dark"] as const).map((theme) => ({
    href: v(`/splash/${theme}-${w}x${h}@${r}x.png`),
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${theme})`,
  })),
);
