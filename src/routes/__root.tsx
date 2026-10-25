import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { APPLE_TOUCH_ICONS, FAVICON_ICO, FAVICON_SVG, MANIFEST_URL } from "@/lib/app-icons";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE } from "@/lib/site";
import { PREFETCH_SCRIPT } from "@/lib/sync/prefetch";
import appCss from "../styles.css?url";
// The main text font is requested together with the CSS, not after it (1.17).

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { title: APP_TITLE },
      {
        name: "description",
        content: APP_DESCRIPTION,
      },
      { name: "theme-color", content: "#f6f4ef" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: APP_TITLE },
      { property: "og:description", content: APP_DESCRIPTION },
      { property: "og:image", content: "/og.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: FAVICON_SVG },
      { rel: "icon", sizes: "16x16 32x32 48x48", href: FAVICON_ICO },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: MANIFEST_URL },
      ...APPLE_TOUCH_ICONS.map(({ size, href }) => ({ rel: "apple-touch-icon", sizes: `${size}x${size}`, href })),
    ],
  }),
  component: () => (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* 1.17: a fresh device asks for its first copy while the app's files load. */}
        <script dangerouslySetInnerHTML={{ __html: PREFETCH_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
