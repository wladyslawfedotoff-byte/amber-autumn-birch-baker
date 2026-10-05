import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { t as authMiddleware } from "./middleware-Cub_ouZo.mjs";
import { r as getSql } from "./db-y2TqIdRS.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/account-sync-4gpPL1Kd.js
function snapshot(data) {
	if (!data || typeof data.updatedAt !== "number" || !Array.isArray(data.tasks) || !Array.isArray(data.lists)) throw new Error("bad snapshot");
	return data;
}
var pullSnapshot_createServerFn_handler = createServerRpc({
	id: "17dce6e2fbe4414952a05e6db96a9e8c0b06d9e39790569ab83b837ce5ae7a83",
	name: "pullSnapshot",
	filename: "src/lib/account-sync.ts"
}, (opts) => pullSnapshot.__executeServer(opts));
var pullSnapshot = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(pullSnapshot_createServerFn_handler, async ({ context }) => {
	const row = (await (await getSql())`
      select updated_at, payload from planner_sync where user_id = ${context.userId}
    `)[0];
	if (!row) return null;
	const payload = JSON.parse(row.payload);
	return {
		updatedAt: Number(row.updated_at),
		payload
	};
});
var pushSnapshot_createServerFn_handler = createServerRpc({
	id: "60742a04073702a645436e9518bdc1f374e7536bcbf8c54c564b6fdfd7726c0f",
	name: "pushSnapshot",
	filename: "src/lib/account-sync.ts"
}, (opts) => pushSnapshot.__executeServer(opts));
var pushSnapshot = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator(snapshot).handler(pushSnapshot_createServerFn_handler, async ({ context, data }) => {
	const sql = await getSql();
	const existing = await sql`
      select updated_at from planner_sync where user_id = ${context.userId}
    `;
	const prev = existing[0] ? Number(existing[0].updated_at) : 0;
	if (prev > data.updatedAt) return {
		ok: false,
		updatedAt: prev
	};
	const body = JSON.stringify(data);
	await sql`
      insert into planner_sync (user_id, updated_at, payload)
      values (${context.userId}, ${data.updatedAt}, ${body})
      on conflict (user_id) do update
      set updated_at = ${data.updatedAt}, payload = ${body}
    `;
	return {
		ok: true,
		updatedAt: data.updatedAt
	};
});
//#endregion
export { pullSnapshot_createServerFn_handler, pushSnapshot_createServerFn_handler };
