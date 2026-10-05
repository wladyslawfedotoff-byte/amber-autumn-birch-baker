import { b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as signIn } from "./client-1vAx-gM_.mjs";
import { t as GROK_PROVIDERS } from "./server-r6W1-LIF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/login-DRwpIeD8.js
var import_jsx_runtime = require_jsx_runtime();
function Login() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-bg p-6 text-fg",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-sm",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display text-3xl tracking-tight",
					children: "Пора"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted",
					children: "Один вход на телефоне и компьютере. Задачи синхронизируются сами."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-6 flex flex-col gap-2",
					children: GROK_PROVIDERS.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => void signIn(provider.providerId, { callbackURL: "/" }),
						className: "h-11 rounded-xl bg-accent text-sm text-accent-fg",
						children: ["Войти через ", provider.label]
					}, provider.providerId))
				})
			]
		})
	});
}
//#endregion
export { Login as component };
