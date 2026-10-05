import { o as __toESM } from "../_runtime.mjs";
import { b as require_jsx_runtime, q as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as getServerFnById, i as TSS_SERVER_FUNCTION, r as createServerFn } from "./ssr.mjs";
import { t as authMiddleware } from "./middleware-Cub_ouZo.mjs";
import { i as signOut, r as signIn, t as authClient } from "./client-1vAx-gM_.mjs";
import { a as hasGateSessionMarker, t as GROK_PROVIDERS } from "./server-r6W1-LIF.mjs";
import { C as CalendarRange, E as Bell, S as CheckCheck, T as CalendarCheck, _ as Columns3, a as Sunrise, b as ChevronLeft, c as Repeat, d as Menu, f as ListChecks, g as GripVertical, h as Hourglass, i as Timer, l as Plus, m as Inbox, o as Settings, p as LayoutGrid, r as Trash2, s as Search, t as X, u as MessageSquare, v as Clock, w as CalendarDays, x as Check, y as ChevronRight } from "../_libs/lucide-react.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { a as endOfWeek, c as endOfMonth, i as format, l as startOfWeek, n as parseISO, o as startOfMonth, r as isSameMonth, s as eachDayOfInterval, t as ru, u as addMonths } from "../_libs/date-fns.mjs";
import { n as persist, r as create, t as createJSONStorage } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-Dggrskvw.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var buttonVariants = cva("press inline-flex items-center justify-center gap-2 rounded-md font-medium disabled:pointer-events-none disabled:opacity-40", {
	variants: {
		variant: {
			primary: "bg-accent text-accent-fg hover:opacity-90",
			soft: "border border-line bg-elevated text-fg hover:bg-surface",
			ghost: "bg-transparent text-fg hover:bg-elevated",
			destructive: "bg-danger text-on-danger hover:opacity-90"
		},
		size: {
			md: "h-11 px-4 text-sm",
			sm: "h-11 px-3 text-sm",
			icon: "size-11"
		}
	},
	defaultVariants: {
		variant: "ghost",
		size: "md"
	}
});
function Button({ className, variant, size, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: cn(buttonVariants({
			variant,
			size
		}), className),
		...props
	});
}
function todayIso(d = /* @__PURE__ */ new Date()) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftIso(iso, days) {
	const [y, m, d] = iso.split("-").map(Number);
	const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
	dt.setDate(dt.getDate() + days);
	return todayIso(dt);
}
function cap(value) {
	if (!value) return value;
	return value.charAt(0).toUpperCase() + value.slice(1);
}
function formatLong(iso) {
	return cap(format(parseISO(iso), "EEEE, d MMMM", { locale: ru }));
}
function formatShort(iso) {
	return format(parseISO(iso), "d MMM", { locale: ru });
}
function formatMonth(date) {
	return cap(format(date, "LLLL yyyy", { locale: ru }));
}
function dueLabel(due, today) {
	if (due === today) return "сегодня";
	if (due === shiftIso(today, 1)) return "завтра";
	if (due === shiftIso(today, -1)) return "вчера";
	return formatShort(due);
}
/** Monday-first week containing `anchor`. */
function weekDays(anchor) {
	const [y, m, d] = anchor.split("-").map(Number);
	const monday = shiftIso(anchor, -((new Date(y, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7));
	return Array.from({ length: 7 }, (_, i) => shiftIso(monday, i));
}
function weekdayLetter(iso) {
	return format(parseISO(iso), "EEEEEE", { locale: ru });
}
function dayNumber(iso) {
	return format(parseISO(iso), "d");
}
function daysBetween(from, to) {
	const [y1, m1, d1] = from.split("-").map(Number);
	const [y2, m2, d2] = to.split("-").map(Number);
	const a = Date.UTC(y1 ?? 1970, (m1 ?? 1) - 1, d1 ?? 1);
	const b = Date.UTC(y2 ?? 1970, (m2 ?? 1) - 1, d2 ?? 1);
	return Math.round((b - a) / 864e5);
}
function repeatLabel(repeat) {
	if (repeat === "day") return "каждый день";
	if (repeat === "weekdays") return "по будням";
	if (repeat === "week") return "каждую неделю";
	return "каждый месяц";
}
function weekday(iso) {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
}
function addMonthsIso(iso, months) {
	const [y, m, d] = iso.split("-").map(Number);
	const anchor = new Date(y ?? 1970, (m ?? 1) - 1 + months, 1);
	const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
	anchor.setDate(Math.min(d ?? 1, last));
	return todayIso(anchor);
}
function stepRepeat(iso, repeat) {
	if (repeat === "day") return shiftIso(iso, 1);
	if (repeat === "week") return shiftIso(iso, 7);
	if (repeat === "month") return addMonthsIso(iso, 1);
	const day = weekday(iso);
	return shiftIso(iso, day === 5 ? 3 : day === 6 ? 2 : 1);
}
/** The next occurrence after both the current due date and today. */
function nextRepeat(due, repeat, today) {
	let cursor = stepRepeat(due, repeat);
	let guard = 0;
	while (cursor <= today && guard < 400) {
		cursor = stepRepeat(cursor, repeat);
		guard += 1;
	}
	return cursor;
}
function nextOccurrence(date, yearly, today) {
	if (!yearly) return date;
	const monthDay = date.slice(5);
	const year = Number(today.slice(0, 4));
	const candidate = `${year}-${monthDay}`;
	return candidate < today ? `${year + 1}-${monthDay}` : candidate;
}
function countdownLabel(days) {
	if (days < 0) return `${Math.abs(days)} дн. назад`;
	if (days === 0) return "сегодня";
	if (days === 1) return "завтра";
	return `через ${days} дн.`;
}
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
function asPlan(input) {
	const data = input ?? {};
	return {
		mode: data.mode === "plan" ? "plan" : "capture",
		text: String(data.text ?? "").trim().slice(0, 1500),
		today: String(data.today ?? "").slice(0, 10),
		lists: Array.isArray(data.lists) ? data.lists.map(String).slice(0, 20) : [],
		openTasks: Array.isArray(data.openTasks) ? data.openTasks.map(String).slice(0, 30) : []
	};
}
var planTasks = createServerFn({ method: "POST" }).validator(asPlan).handler(createSsrRpc("e408d72742efa804e11abe92a1bc96d9037502ba50a4946b4fda806cebe4fd74"));
var WEEKDAY = {
	понедельник: 1,
	пн: 1,
	вторник: 2,
	вт: 2,
	среда: 3,
	среду: 3,
	ср: 3,
	четверг: 4,
	чт: 4,
	пятница: 5,
	пятницу: 5,
	пт: 5,
	суббота: 6,
	субботу: 6,
	сб: 6,
	воскресенье: 0,
	вс: 0
};
function iso(date) {
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${m}-${d}`;
}
function shift(isoDay, days) {
	const [y, m, d] = isoDay.split("-").map(Number);
	const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	date.setDate(date.getDate() + days);
	return iso(date);
}
function pad(hours, minutes) {
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
/** 1–7 without a hint means afternoon. «утра» keeps the morning hour. */
function toClock(hour, minute, hint) {
	if (minute > 59 || hour > 23) return null;
	let h = hour;
	const part = hint?.toLowerCase();
	if (part === "вечера" || part === "вечером" || part === "дня" || part === "днём" || part === "днем") {
		if (h < 12) h += 12;
	} else if (part === "ночи" && h === 12) h = 0;
	else if (part !== "утра" && h >= 1 && h <= 7) h += 12;
	if (h > 23) return null;
	return pad(h, minute);
}
function weekdayOn(today, jsDay) {
	const [y, m, d] = today.split("-").map(Number);
	return shift(today, (jsDay - new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay() + 7) % 7);
}
function cut(text, re) {
	const match = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`).exec(text);
	if (!match) return {
		text,
		match: null
	};
	return {
		text: `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim(),
		match
	};
}
/** Pull a date and a time out of a Russian task line. The rest stays the title. */
function parseQuick(raw, today = iso(/* @__PURE__ */ new Date())) {
	let text = raw.replace(/\s+/g, " ").trim();
	let due = null;
	let startAt = null;
	let endAt = null;
	const range = cut(text, /(?:^|\s)(?:с|со)\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?:[:.](\d{2}))?(?=\s|$)/i);
	if (range.match) {
		text = range.text;
		const from = toClock(Number(range.match[1]), Number(range.match[2] ?? 0), "утра");
		let to = toClock(Number(range.match[3]), Number(range.match[4] ?? 0), "утра");
		if (from && to && to <= from) {
			const [h, m] = to.split(":").map(Number);
			if ((h ?? 0) < 12) to = toClock((h ?? 0) + 12, m ?? 0, "утра");
		}
		if (from && to && to > from) {
			startAt = from;
			endAt = to;
		}
	}
	if (!startAt) {
		const at = cut(text, /(?:^|\s)(?:в|во|к|на)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s+(утра|вечера|вечером|дня|днём|днем|ночи))?(?!\s*(?:мин|час))(?=\s|$)/i);
		if (at.match) {
			const clock = toClock(Number(at.match[1]), Number(at.match[2] ?? 0), at.match[3]);
			if (clock) {
				text = at.text;
				startAt = clock;
			}
		}
	}
	if (!startAt) {
		const bare = cut(text, /(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/);
		if (bare.match) {
			const clock = toClock(Number(bare.match[1]), Number(bare.match[2]), "утра");
			if (clock) {
				text = bare.text;
				startAt = clock;
			}
		}
	}
	if (startAt && !endAt) {
		const hour = cut(text, /(?:^|\s)на\s+час(?=\s|$)/i);
		if (hour.match) {
			text = hour.text;
			const [h, m] = startAt.split(":").map(Number);
			const total = (h ?? 0) * 60 + (m ?? 0) + 60;
			if (total < 1440) endAt = pad(Math.floor(total / 60), total % 60);
		}
	}
	const relative = cut(text, /(?:^|\s)через\s+(\d{1,2})\s+(?:день|дня|дней)(?=\s|$)/i);
	if (relative.match) {
		text = relative.text;
		due = shift(today, Number(relative.match[1]));
	}
	if (!due) {
		const one = cut(text, /(?:^|\s)через\s+(?:день|неделю)(?=\s|$)/i);
		if (one.match) {
			text = one.text;
			due = shift(today, /недел/i.test(one.match[0]) ? 7 : 1);
		}
	}
	if (!due) {
		const named = cut(text, /(?:^|\s)(?:на\s+)?(послезавтра|завтра|сегодня)(?=\s|$)/i);
		if (named.match) {
			text = named.text;
			const word = named.match[1]?.toLowerCase();
			due = word === "сегодня" ? today : shift(today, word === "завтра" ? 1 : 2);
		}
	}
	if (!due) {
		const week = cut(text, /(?:^|\s)(?:в|во|на)\s+(понедельник|вторник|сред[ую]|четверг|пятниц[ую]|суббот[ую]|воскресенье|пн|вт|ср|чт|пт|сб|вс)(?=\s|$)/i);
		if (week.match) {
			const day = WEEKDAY[week.match[1]?.toLowerCase() ?? ""];
			if (day != null) {
				text = week.text;
				due = weekdayOn(today, day);
			}
		}
	}
	return {
		title: text.replace(/^[,.:\-–—]+|[,.:\-–—]+$/g, "").replace(/\s+/g, " ").trim(),
		due,
		startAt,
		endAt
	};
}
/** Where a stage sits on the calendar. Explicit dates win; otherwise the project is split evenly. */
function stageRange(project, stage, index) {
	if (stage.start && stage.end && stage.end >= stage.start) return {
		start: stage.start,
		end: stage.end
	};
	if (!project.start || !project.end || project.end < project.start) return null;
	const count = Math.max(project.stages.length, 1);
	const total = daysBetween(project.start, project.end) + 1;
	const span = Math.max(1, Math.floor(total / count));
	const offset = Math.min(index * span, Math.max(0, total - 1));
	const start = shiftIso(project.start, offset);
	const end = index === count - 1 ? project.end : shiftIso(project.start, Math.min(offset + span - 1, total - 1));
	return {
		start,
		end: end < start ? start : end
	};
}
var ACCENTS = [
	{
		id: "ink",
		name: "Чернила",
		swatch: "swatch-ink"
	},
	{
		id: "blue",
		name: "Синий",
		swatch: "swatch-blue"
	},
	{
		id: "teal",
		name: "Бирюза",
		swatch: "swatch-teal"
	},
	{
		id: "green",
		name: "Зелёный",
		swatch: "swatch-green"
	},
	{
		id: "orange",
		name: "Оранжевый",
		swatch: "swatch-orange"
	},
	{
		id: "red",
		name: "Красный",
		swatch: "swatch-red"
	},
	{
		id: "purple",
		name: "Фиолетовый",
		swatch: "swatch-purple"
	},
	{
		id: "pink",
		name: "Розовый",
		swatch: "swatch-pink"
	}
];
function isAccent(value) {
	return ACCENTS.some((item) => item.id === value);
}
function breakFor(workLen) {
	return workLen >= 3e3 ? 600 : 300;
}
function freshFocus() {
	return {
		mode: "work",
		workLen: 1500,
		seconds: 1500,
		running: false,
		endsAt: null,
		taskId: null,
		note: null
	};
}
function uid() {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}
function seed() {
	const today = todayIso();
	const stamp = Date.now();
	const task = (partial) => ({
		notes: "",
		tags: [],
		subtasks: [],
		done: false,
		completedAt: null,
		important: false,
		urgent: false,
		remindAt: null,
		startAt: null,
		endAt: null,
		...partial
	});
	return {
		theme: "light",
		accent: "ink",
		pomoDate: today,
		pomoCount: 1,
		remindAck: {},
		lists: [
			{
				id: "work",
				name: "Работа"
			},
			{
				id: "home",
				name: "Дом"
			},
			{
				id: "study",
				name: "Учёба"
			}
		],
		habits: [
			{
				id: "water",
				name: "Вода",
				checks: [
					shiftIso(today, -1),
					shiftIso(today, -2),
					shiftIso(today, -3),
					today
				],
				why: "Стакан сразу после подъёма",
				remindAt: "08:00"
			},
			{
				id: "walk",
				name: "Прогулка",
				checks: [shiftIso(today, -1), shiftIso(today, -2)],
				why: "20 минут без телефона",
				remindAt: "08:00"
			},
			{
				id: "read",
				name: "Чтение",
				checks: [shiftIso(today, -1), today],
				why: "Десять страниц перед сном",
				remindAt: "21:30"
			}
		],
		milestones: [{
			id: "m-bday",
			title: "День рождения",
			date: shiftIso(today, 4),
			yearly: true,
			kind: "birthday",
			remindAt: "09:00"
		}, {
			id: "m-ann",
			title: "Годовщина",
			date: shiftIso(today, 18),
			yearly: true,
			kind: "anniversary",
			remindAt: "09:00"
		}],
		focus: freshFocus(),
		workStart: "09:00",
		workEnd: "18:00",
		projects: [{
			id: "p-deck",
			title: "Презентация",
			start: shiftIso(today, -1),
			end: shiftIso(today, 6),
			stages: [
				{
					id: "st-plan",
					title: "План",
					start: shiftIso(today, -1),
					end: shiftIso(today, 1),
					cards: [{
						id: "c-nums",
						title: "Собрать цифры"
					}, {
						id: "c-shape",
						title: "Структура слайдов"
					}]
				},
				{
					id: "st-work",
					title: "В работе",
					start: shiftIso(today, 2),
					end: shiftIso(today, 4),
					cards: [{
						id: "c-draft",
						title: "Черновик"
					}]
				},
				{
					id: "st-done",
					title: "Готово",
					start: shiftIso(today, 5),
					end: shiftIso(today, 6),
					cards: []
				}
			]
		}],
		tasks: [
			task({
				id: "t-draft",
				title: "Сдать черновик презентации",
				listId: "work",
				priority: 3,
				due: shiftIso(today, -1),
				notes: "Коротко: проблема, решение, срок. Без лишних слайдов.",
				tags: ["жду"],
				important: true,
				urgent: true,
				remindAt: "10:00",
				createdAt: stamp - 864e5
			}),
			task({
				id: "t-call",
				title: "Созвон с командой",
				listId: "work",
				priority: 3,
				due: today,
				tags: ["звонок"],
				notes: "Повестка: статус, блокеры, кто что берёт на неделю.",
				important: true,
				urgent: true,
				remindAt: "09:00",
				startAt: "09:00",
				endAt: "10:00",
				createdAt: stamp - 72e6
			}),
			task({
				id: "t-shop",
				title: "Купить продукты",
				listId: "home",
				priority: 2,
				due: today,
				important: false,
				urgent: true,
				remindAt: "19:30",
				startAt: "19:00",
				endAt: "19:45",
				subtasks: [
					{
						id: "s1",
						title: "Молоко",
						done: true
					},
					{
						id: "s2",
						title: "Хлеб",
						done: false
					},
					{
						id: "s3",
						title: "Фрукты",
						done: false
					}
				],
				createdAt: stamp - 5e7
			}),
			task({
				id: "t-letter",
				title: "Письмо клиенту",
				listId: "work",
				priority: 2,
				due: today,
				important: true,
				urgent: false,
				startAt: "09:30",
				endAt: "10:30",
				remindAt: "09:30",
				createdAt: stamp - 18e6
			}),
			task({
				id: "t-notes",
				title: "Конспект главы",
				listId: "study",
				priority: 1,
				due: today,
				important: true,
				urgent: false,
				startAt: "11:00",
				endAt: "12:30",
				createdAt: stamp - 2e7
			}),
			task({
				id: "t-mail",
				title: "Разобрать почту",
				listId: "work",
				priority: 0,
				due: today,
				done: true,
				completedAt: stamp - 36e5,
				createdAt: stamp - 9e7
			}),
			task({
				id: "t-doctor",
				title: "Записаться к врачу",
				listId: null,
				priority: 2,
				due: shiftIso(today, 1),
				important: true,
				urgent: false,
				createdAt: stamp - 1e7
			}),
			task({
				id: "t-net",
				title: "Оплатить интернет",
				listId: "home",
				priority: 1,
				due: shiftIso(today, 2),
				createdAt: stamp - 9e6
			}),
			task({
				id: "t-study",
				title: "Разобрать заметки с лекции",
				listId: "study",
				priority: 0,
				due: shiftIso(today, 3),
				createdAt: stamp - 8e6
			}),
			task({
				id: "t-plan",
				title: "План на следующую неделю",
				listId: "work",
				priority: 1,
				due: shiftIso(today, 5),
				important: true,
				urgent: false,
				repeat: "week",
				createdAt: stamp - 7e6
			}),
			task({
				id: "t-idea",
				title: "Идея для побочного проекта",
				listId: null,
				priority: 0,
				due: null,
				notes: "Короткий список: для кого, зачем, что можно выкинуть.",
				createdAt: stamp - 6e6
			})
		]
	};
}
var memoryStorage = {
	getItem: () => null,
	setItem: () => void 0,
	removeItem: () => void 0
};
function fillRemindAt(saved, seedRows) {
	if (!saved) return seedRows;
	const fromSeed = new Map(seedRows.map((row) => [row.id, row.remindAt]));
	return saved.map((row) => {
		if (row.remindAt !== void 0) return row;
		const fallback = fromSeed.get(row.id);
		return fallback === void 0 ? {
			...row,
			remindAt: null
		} : {
			...row,
			remindAt: fallback
		};
	});
}
function fillTasks(saved, seedRows) {
	return fillRemindAt(saved, seedRows).map((row) => ({
		...row,
		startAt: row.startAt ?? null,
		endAt: row.endAt ?? null,
		tags: row.tags ?? [],
		subtasks: row.subtasks ?? []
	}));
}
var usePlanner = create()(persist((set, get) => ({
	...seed(),
	addTask: (input) => {
		const parsed = parseQuick(input.title);
		const title = parsed.title.trim();
		const id = uid();
		if (!title) return id;
		const timed = parsed.startAt != null;
		const task = {
			id,
			title,
			notes: input.notes ?? "",
			listId: input.listId,
			done: false,
			priority: input.priority ?? 0,
			due: parsed.due ?? input.due,
			tags: input.tags ?? [],
			subtasks: [],
			createdAt: Date.now(),
			completedAt: null,
			important: input.important ?? false,
			urgent: input.urgent ?? false,
			remindAt: timed ? parsed.startAt : input.remindAt ?? null,
			startAt: timed ? parsed.startAt : input.startAt ?? null,
			endAt: timed ? parsed.endAt : input.endAt ?? null
		};
		set((s) => ({ tasks: [task, ...s.tasks] }));
		return id;
	},
	updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((t) => t.id === id ? {
		...t,
		...patch
	} : t) })),
	toggleTask: (id) => set((s) => ({ tasks: s.tasks.map((t) => {
		if (t.id !== id) return t;
		if (!t.done && t.repeat && t.due) return {
			...t,
			done: false,
			completedAt: null,
			due: nextRepeat(t.due, t.repeat, todayIso())
		};
		const done = !t.done;
		return {
			...t,
			done,
			completedAt: done ? Date.now() : null
		};
	}) })),
	deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
	addSubtask: (taskId, title) => {
		const clean = title.trim();
		if (!clean) return;
		set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? {
			...t,
			subtasks: [...t.subtasks, {
				id: uid(),
				title: clean,
				done: false
			}]
		} : t) }));
	},
	toggleSubtask: (taskId, subId) => set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? {
		...t,
		subtasks: t.subtasks.map((sub) => sub.id === subId ? {
			...sub,
			done: !sub.done
		} : sub)
	} : t) })),
	deleteSubtask: (taskId, subId) => set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? {
		...t,
		subtasks: t.subtasks.filter((sub) => sub.id !== subId)
	} : t) })),
	addList: (name) => {
		const id = uid();
		const clean = name.trim() || "Новый список";
		set((s) => ({ lists: [...s.lists, {
			id,
			name: clean
		}] }));
		return id;
	},
	renameList: (id, name) => set((s) => ({ lists: s.lists.map((l) => l.id === id ? {
		...l,
		name
	} : l) })),
	deleteList: (id) => set((s) => ({
		lists: s.lists.filter((l) => l.id !== id),
		tasks: s.tasks.map((t) => t.listId === id ? {
			...t,
			listId: null
		} : t)
	})),
	addHabit: (name) => {
		const clean = name.trim();
		if (!clean) return;
		set((s) => ({ habits: [...s.habits, {
			id: uid(),
			name: clean,
			checks: [],
			remindAt: null
		}] }));
	},
	updateHabit: (id, patch) => set((s) => ({ habits: s.habits.map((h) => h.id === id ? {
		...h,
		...patch
	} : h) })),
	toggleHabit: (id, date) => set((s) => ({ habits: s.habits.map((h) => {
		if (h.id !== id) return h;
		const has = h.checks.includes(date);
		return {
			...h,
			checks: has ? h.checks.filter((d) => d !== date) : [...h.checks, date]
		};
	}) })),
	deleteHabit: (id) => set((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
	addMilestone: (input) => {
		const title = input.title.trim();
		if (!title || !input.date) return;
		set((s) => ({ milestones: [...s.milestones, {
			id: uid(),
			title,
			date: input.date,
			yearly: input.yearly,
			kind: input.kind,
			remindAt: input.remindAt === void 0 ? "09:00" : input.remindAt
		}] }));
	},
	updateMilestone: (id, patch) => set((s) => ({ milestones: s.milestones.map((m) => m.id === id ? {
		...m,
		...patch
	} : m) })),
	deleteMilestone: (id) => set((s) => ({ milestones: s.milestones.filter((m) => m.id !== id) })),
	addProject: (title) => {
		const id = uid();
		const clean = title.trim();
		if (!clean) return id;
		const project = {
			id,
			title: clean,
			start: null,
			end: null,
			stages: [
				{
					id: uid(),
					title: "План",
					cards: []
				},
				{
					id: uid(),
					title: "В работе",
					cards: []
				},
				{
					id: uid(),
					title: "Готово",
					cards: []
				}
			]
		};
		set((s) => ({ projects: [...s.projects ?? [], project] }));
		return id;
	},
	updateProject: (id, patch) => set((s) => ({ projects: (s.projects ?? []).map((project) => project.id === id ? {
		...project,
		...patch
	} : project) })),
	deleteProject: (id) => set((s) => ({ projects: (s.projects ?? []).filter((project) => project.id !== id) })),
	addStage: (projectId, title) => {
		const clean = title.trim();
		if (!clean) return;
		set((s) => ({ projects: (s.projects ?? []).map((project) => project.id === projectId ? {
			...project,
			stages: [...project.stages, {
				id: uid(),
				title: clean,
				cards: []
			}]
		} : project) }));
	},
	renameStage: (projectId, stageId, title) => set((s) => ({ projects: (s.projects ?? []).map((project) => project.id === projectId ? {
		...project,
		stages: project.stages.map((stage) => stage.id === stageId ? {
			...stage,
			title: title.trim() || stage.title
		} : stage)
	} : project) })),
	placeStage: (projectId, stageId, start, end) => set((s) => ({ projects: (s.projects ?? []).map((project) => {
		if (project.id !== projectId || end < start) return project;
		return {
			...project,
			stages: project.stages.map((stage, index) => {
				if (stage.id === stageId) return {
					...stage,
					start,
					end
				};
				if (stage.start && stage.end) return stage;
				const range = stageRange(project, stage, index);
				return range ? {
					...stage,
					start: range.start,
					end: range.end
				} : stage;
			})
		};
	}) })),
	deleteStage: (projectId, stageId) => set((s) => ({ projects: (s.projects ?? []).map((project) => {
		if (project.id !== projectId || project.stages.length < 2) return project;
		const index = project.stages.findIndex((stage) => stage.id === stageId);
		if (index < 0) return project;
		const removed = project.stages[index];
		const rest = project.stages.filter((stage) => stage.id !== stageId);
		const host = rest[Math.max(0, index - 1)];
		if (!host || !removed) return project;
		rest[Math.max(0, index - 1)] = {
			...host,
			cards: [...host.cards, ...removed.cards]
		};
		return {
			...project,
			stages: rest
		};
	}) })),
	addCard: (projectId, stageId, title) => {
		const clean = title.trim();
		if (!clean) return;
		set((s) => ({ projects: (s.projects ?? []).map((project) => project.id === projectId ? {
			...project,
			stages: project.stages.map((stage) => stage.id === stageId ? {
				...stage,
				cards: [...stage.cards, {
					id: uid(),
					title: clean
				}]
			} : stage)
		} : project) }));
	},
	moveCard: (projectId, cardId, toStageId) => set((s) => ({ projects: (s.projects ?? []).map((project) => {
		if (project.id !== projectId) return project;
		let moving = null;
		const stripped = project.stages.map((stage) => {
			const card = stage.cards.find((item) => item.id === cardId);
			if (!card) return stage;
			moving = card;
			return {
				...stage,
				cards: stage.cards.filter((item) => item.id !== cardId)
			};
		});
		if (!moving) return project;
		return {
			...project,
			stages: stripped.map((stage) => stage.id === toStageId ? {
				...stage,
				cards: [...stage.cards, moving]
			} : stage)
		};
	}) })),
	deleteCard: (projectId, cardId) => set((s) => ({ projects: (s.projects ?? []).map((project) => project.id === projectId ? {
		...project,
		stages: project.stages.map((stage) => ({
			...stage,
			cards: stage.cards.filter((card) => card.id !== cardId)
		}))
	} : project) })),
	setWorkHours: (start, end) => set({
		workStart: start,
		workEnd: end
	}),
	importBackup: (raw) => {
		if (!raw || typeof raw !== "object") return false;
		const data = raw;
		if (!Array.isArray(data.tasks) || !Array.isArray(data.lists)) return false;
		set({
			tasks: data.tasks,
			lists: data.lists,
			habits: Array.isArray(data.habits) ? data.habits : [],
			milestones: Array.isArray(data.milestones) ? data.milestones : [],
			projects: Array.isArray(data.projects) ? data.projects : [],
			workStart: typeof data.workStart === "string" ? data.workStart : "09:00",
			workEnd: typeof data.workEnd === "string" ? data.workEnd : "18:00"
		});
		return true;
	},
	ackReminder: (key, stamp) => set((s) => ({ remindAck: {
		...s.remindAck ?? {},
		[key]: stamp
	} })),
	setTheme: (theme) => set({ theme }),
	setAccent: (accent) => set({ accent }),
	bumpPomo: () => set((s) => {
		const today = todayIso();
		return {
			pomoDate: today,
			pomoCount: s.pomoDate === today ? s.pomoCount + 1 : 1
		};
	}),
	startFocus: () => set((s) => ({ focus: {
		...s.focus,
		running: true,
		endsAt: Date.now() + Math.max(1, s.focus.seconds) * 1e3,
		note: null
	} })),
	pauseFocus: () => set((s) => ({ focus: {
		...s.focus,
		running: false,
		endsAt: null
	} })),
	resetFocus: () => set((s) => {
		const seconds = s.focus.mode === "work" ? s.focus.workLen : breakFor(s.focus.workLen);
		return { focus: {
			...s.focus,
			running: false,
			endsAt: null,
			seconds,
			note: null
		} };
	}),
	setWorkLen: (workLen) => set((s) => ({ focus: {
		...s.focus,
		workLen,
		mode: "work",
		seconds: workLen,
		running: false,
		endsAt: null,
		note: null
	} })),
	setFocusTask: (taskId) => set((s) => ({ focus: {
		...s.focus,
		taskId
	} })),
	tickFocus: () => {
		const s = get();
		if (!s.focus.running || s.focus.endsAt == null) return false;
		const left = Math.max(0, Math.round((s.focus.endsAt - Date.now()) / 1e3));
		if (left > 0) {
			if (left !== s.focus.seconds) set({ focus: {
				...s.focus,
				seconds: left
			} });
			return false;
		}
		const work = s.focus.mode === "work";
		const today = todayIso();
		set({
			pomoDate: work ? today : s.pomoDate,
			pomoCount: work ? s.pomoDate === today ? s.pomoCount + 1 : 1 : s.pomoCount,
			focus: {
				...s.focus,
				running: false,
				endsAt: null,
				mode: work ? "break" : "work",
				seconds: work ? breakFor(s.focus.workLen) : s.focus.workLen,
				note: work ? "Фокус-сессия завершена. Можно сделать перерыв." : "Перерыв закончился."
			}
		});
		return true;
	}
}), {
	name: "srok-planner",
	skipHydration: true,
	merge: (persisted, current) => {
		const saved = persisted ?? {};
		return {
			...current,
			...saved,
			milestones: fillRemindAt(saved.milestones, current.milestones),
			projects: saved.projects ?? current.projects,
			workStart: saved.workStart ?? current.workStart,
			workEnd: saved.workEnd ?? current.workEnd,
			focus: saved.focus ?? current.focus,
			habits: fillRemindAt(saved.habits, current.habits),
			tasks: fillTasks(saved.tasks, current.tasks),
			lists: saved.lists ?? current.lists,
			remindAck: saved.remindAck ?? {},
			theme: saved.theme === "dark" ? "dark" : "light",
			accent: isAccent(saved.accent) ? saved.accent : current.accent
		};
	},
	storage: createJSONStorage(() => typeof window === "undefined" ? memoryStorage : window.localStorage)
}));
function AssistView({ onOpen }) {
	const lists = usePlanner((s) => s.lists);
	const tasks = usePlanner((s) => s.tasks);
	const addTask = usePlanner((s) => s.addTask);
	const [text, setText] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)("");
	const [drafts, setDrafts] = (0, import_react.useState)([]);
	const [picked, setPicked] = (0, import_react.useState)([]);
	const [error, setError] = (0, import_react.useState)("");
	const [pending, setPending] = (0, import_react.useState)(null);
	async function ask(mode) {
		if (pending) return;
		setPending(mode);
		setError("");
		try {
			const result = await planTasks({ data: {
				mode,
				text,
				today: todayIso(),
				lists: lists.map((list) => list.name),
				openTasks: tasks.filter((task) => !task.done).map((task) => task.title)
			} });
			if (!result.ok) {
				setError(result.error);
				return;
			}
			setNote(result.note);
			setDrafts(result.tasks);
			setPicked(result.tasks.map(() => true));
		} catch {
			setError("Не удалось спросить помощника.");
		} finally {
			setPending(null);
		}
	}
	function accept() {
		for (const [index, draft] of drafts.entries()) {
			if (!picked[index]) continue;
			const list = lists.find((item) => item.name.toLowerCase() === (draft.list ?? "").toLowerCase());
			const id = addTask({
				title: draft.title,
				due: draft.due,
				listId: list?.id ?? null,
				important: draft.important,
				urgent: draft.urgent,
				priority: draft.important && draft.urgent ? 3 : draft.important ? 2 : draft.urgent ? 1 : 0
			});
			if (index === drafts.findIndex((_, i) => picked[i])) onOpen(id);
		}
		setDrafts([]);
		setPicked([]);
		setText("");
		setNote(note ? `${note} Добавлено.` : "Добавлено.");
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto max-w-xl",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Напишите, что крутится в голове. Помощник разложит это на задачи или соберёт план на сегодня из того, что уже есть."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
				value: text,
				onChange: (event) => setText(event.target.value),
				rows: 6,
				placeholder: "Завтра созвон, купить подарок к дню рождения, дописать отчёт...",
				className: "mt-4 w-full resize-y rounded-lg border border-line bg-elevated px-3 py-3 text-sm outline-none placeholder:text-subtle"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "primary",
					disabled: pending !== null || !text.trim(),
					onClick: () => void ask("capture"),
					children: pending === "capture" ? "Разбираю…" : "Разобрать в задачи"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "soft",
					disabled: pending !== null,
					onClick: () => void ask("plan"),
					children: pending === "plan" ? "Думаю…" : "План на сегодня"
				})]
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-sm text-danger",
				children: error
			}) : null,
			note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-sm text-fg",
				children: note
			}) : null,
			drafts.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 divide-y divide-line rounded-lg border border-line",
				children: drafts.map((draft, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-start gap-3 px-3 py-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "checkbox",
						className: "mt-1 size-4",
						checked: picked[index] ?? false,
						onChange: () => setPicked((current) => current.map((value, i) => i === index ? !value : value)),
						"aria-label": draft.title
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm",
							children: draft.title
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs text-muted",
							children: [
								draft.due,
								draft.list,
								draft.important ? "важно" : null,
								draft.urgent ? "срочно" : null
							].filter(Boolean).join(" · ") || "без даты"
						})]
					})]
				}, `${draft.title}-${index}`))
			}) : null,
			drafts.some((_, index) => picked[index]) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "primary",
				className: "mt-3",
				onClick: accept,
				children: "Добавить выбранные"
			}) : null
		]
	});
}
function countToday(tasks, today) {
	return tasks.filter((t) => !t.done && t.due != null && t.due <= today).length;
}
function countTomorrow(tasks, today) {
	const tomorrow = shiftIso(today, 1);
	return tasks.filter((t) => !t.done && t.due === tomorrow).length;
}
function countWeek(tasks, today) {
	const end = shiftIso(today, 6);
	return tasks.filter((t) => !t.done && t.due != null && t.due >= today && t.due <= end).length;
}
function countOpen(tasks) {
	return tasks.filter((t) => !t.done).length;
}
function countInbox(tasks) {
	return tasks.filter((t) => !t.done && t.listId == null).length;
}
function countList(tasks, id) {
	return tasks.filter((t) => !t.done && t.listId === id).length;
}
function scopeTasks(tasks, view, today) {
	const end = shiftIso(today, 6);
	return tasks.filter((t) => {
		if (view === "today") {
			if (t.done) return false;
			return t.due != null && t.due <= today;
		}
		if (view === "tomorrow") return !t.done && t.due === shiftIso(today, 1);
		if (view === "week") return !t.done && t.due != null && t.due >= today && t.due <= end;
		if (view === "inbox") return !t.done && t.listId == null;
		if (view === "done") return t.done;
		if (view.startsWith("list:")) return !t.done && t.listId === view.slice(5);
		if (view.startsWith("tag:")) return !t.done && t.tags.includes(view.slice(4));
		if (view.startsWith("day:")) return !t.done && t.due === view.slice(4);
		return false;
	});
}
function doneInScope(tasks, view, today) {
	if (view === "done" || view === "week" || view === "calendar" || view === "focus" || view === "habits") return [];
	return tasks.filter((t) => {
		if (!t.done) return false;
		if (view === "today") return t.due != null && t.due <= today;
		if (view === "tomorrow") return t.due === shiftIso(today, 1);
		if (view === "inbox") return t.listId == null;
		if (view.startsWith("list:")) return t.listId === view.slice(5);
		if (view.startsWith("tag:")) return t.tags.includes(view.slice(4));
		if (view.startsWith("day:")) return t.due === view.slice(4);
		return false;
	}).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}
function matchesQuery(task, query, lists) {
	const n = query.trim().toLowerCase();
	if (!n) return true;
	const listName = lists.find((l) => l.id === task.listId)?.name ?? "входящие";
	return task.title.toLowerCase().includes(n) || task.notes.toLowerCase().includes(n) || listName.toLowerCase().includes(n) || task.tags.some((tag) => tag.toLowerCase().includes(n)) || task.subtasks.some((sub) => sub.title.toLowerCase().includes(n));
}
function byNewest(a, b) {
	return b.createdAt - a.createdAt;
}
function listName(lists, id) {
	if (!id) return "Входящие";
	return lists.find((l) => l.id === id)?.name ?? "Входящие";
}
function ring(priority) {
	if (priority === 3) return "border-danger";
	if (priority === 2) return "border-warn";
	if (priority === 1) return "border-accent";
	return "border-line";
}
function TaskRow({ task, today, selected, showDue, showList, onOpen, onDragStart }) {
	const lists = usePlanner((s) => s.lists);
	const toggleTask = usePlanner((s) => s.toggleTask);
	const toggleSubtask = usePlanner((s) => s.toggleSubtask);
	const updateTask = usePlanner((s) => s.updateTask);
	const subs = task.subtasks ?? [];
	const doneSubs = subs.filter((s) => s.done).length;
	const overdue = !task.done && task.due != null && task.due < today;
	const tomorrow = shiftIso(today, 1);
	const canPostpone = !task.done && !onDragStart && overdue;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: cn("card-lift mb-2 flex items-start rounded-xl bg-elevated", selected ? "ring-1 ring-accent" : ""),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": task.done ? "Вернуть в работу" : "Выполнить",
				"aria-pressed": task.done,
				onClick: () => toggleTask(task.id),
				className: "flex size-11 shrink-0 items-center justify-center",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: cn("flex size-6 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-150", task.done ? "border-accent bg-accent text-accent-fg" : ring(task.priority)),
					children: task.done ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
						className: "size-3",
						strokeWidth: 3
					}) : null
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "min-w-0 flex-1 py-2 pr-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-start",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => onOpen(task.id),
						className: "min-w-0 flex-1 pr-2 text-left",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: cn("block text-pretty text-base", task.done ? "text-subtle line-through decoration-subtle" : "text-fg"),
							children: task.title
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted",
							children: [
								showDue && task.due ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: overdue ? "text-danger" : void 0,
									children: dueLabel(task.due, today)
								}) : null,
								task.startAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "tabular-nums",
									children: [task.startAt, task.endAt ? `–${task.endAt}` : ""]
								}) : task.remindAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "tabular-nums",
									children: task.remindAt
								}) : null,
								task.repeat ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: repeatLabel(task.repeat) }) : null,
								showList ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: listName(lists, task.listId) }) : null,
								subs.length > 0 && task.done ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "tabular-nums",
									children: [
										doneSubs,
										"/",
										subs.length
									]
								}) : null,
								(task.tags ?? []).slice(0, 2).map((tag) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["#", tag] }, tag))
							]
						})]
					}), canPostpone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-label": `Перенести «${task.title}» на завтра`,
						onClick: () => updateTask(task.id, { due: tomorrow }),
						className: cn("flex h-11 shrink-0 items-center rounded-full px-3 text-xs", overdue ? "bg-bg text-danger" : "text-subtle"),
						children: "завтра"
					}) : null]
				}), !task.done && subs.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-1",
					children: subs.map((sub) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-pressed": sub.done,
						onClick: () => toggleSubtask(task.id, sub.id),
						className: "flex h-10 w-full items-center gap-2 text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: cn("flex size-4 shrink-0 items-center justify-center rounded-full border", sub.done ? "border-accent bg-accent text-accent-fg" : "border-line"),
							children: sub.done ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, {
								className: "size-2.5",
								strokeWidth: 3
							}) : null
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: cn("min-w-0 flex-1 truncate", sub.done ? "text-subtle line-through" : "text-fg"),
							children: sub.title
						})]
					}) }, sub.id))
				}) : null]
			}),
			onDragStart ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": `Перенести ${task.title}`,
				className: "drag-handle flex size-11 shrink-0 items-center justify-center text-subtle",
				onPointerDown: onDragStart,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GripVertical, { className: "size-4" })
			}) : null
		]
	});
}
function AddTaskForm({ placeholder, onAdd }) {
	const [value, setValue] = (0, import_react.useState)("");
	const parsed = parseQuick(value);
	const hint = parsed.due || parsed.startAt ? [parsed.due ? dueLabel(parsed.due, todayIso()) : null, parsed.startAt ? parsed.endAt ? `${parsed.startAt}–${parsed.endAt}` : parsed.startAt : null].filter(Boolean).join(" · ") : "";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "card-lift flex items-center gap-2 rounded-2xl bg-elevated pr-1 pl-3",
		onSubmit: (event) => {
			event.preventDefault();
			const title = value.trim();
			if (!title || !parseQuick(title).title) return;
			onAdd(title);
			setValue("");
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "size-2 shrink-0 rounded-full border-2 border-subtle",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				name: "title",
				value,
				onChange: (event) => setValue(event.target.value),
				"aria-label": placeholder,
				placeholder,
				autoComplete: "off",
				className: "h-11 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle",
				suppressHydrationWarning: true
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "submit",
				"aria-label": "Добавить",
				className: cn("flex size-11 shrink-0 items-center justify-center rounded-full", value.trim() ? "bg-accent text-accent-fg" : "text-subtle"),
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "size-5" })
			})
		]
	}), hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "mt-1 px-3 text-xs text-muted",
		children: hint
	}) : null] });
}
function dayAt(x, y) {
	const nodes = [...document.querySelectorAll("[data-day]")];
	for (const node of nodes) {
		const rect = node.getBoundingClientRect();
		if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return node.dataset.day ?? null;
	}
	let best = null;
	for (const node of nodes) {
		const rect = node.getBoundingClientRect();
		if (x < rect.left || x > rect.right) continue;
		const dy = Math.abs(y - (rect.top + rect.height / 2));
		const iso = node.dataset.day ?? "";
		if (!best || dy < best.dy) best = {
			iso,
			dy
		};
	}
	if (!best || best.dy > 140 || !best.iso) return null;
	return best.iso;
}
function CalendarView({ selectedId, onOpen }) {
	const tasks = usePlanner((s) => s.tasks);
	const projects = usePlanner((s) => s.projects) ?? [];
	const addTask = usePlanner((s) => s.addTask);
	const updateTask = usePlanner((s) => s.updateTask);
	const placeStage = usePlanner((s) => s.placeStage);
	const today = todayIso();
	const [cursor, setCursor] = (0, import_react.useState)(() => /* @__PURE__ */ new Date());
	const [day, setDay] = (0, import_react.useState)(today);
	const [drag, setDrag] = (0, import_react.useState)(null);
	const dragRef = (0, import_react.useRef)(null);
	const rootRef = (0, import_react.useRef)(null);
	function nudgeScroll(y) {
		let node = rootRef.current?.parentElement ?? null;
		while (node) {
			const overflow = getComputedStyle(node).overflowY;
			if (overflow === "auto" || overflow === "scroll") break;
			node = node.parentElement;
		}
		if (!node) return;
		const rect = node.getBoundingClientRect();
		if (y < rect.top + 64) node.scrollTop -= 20;
		else if (y > rect.bottom - 72) node.scrollTop += 20;
	}
	const cells = (0, import_react.useMemo)(() => {
		const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
		const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
		return eachDayOfInterval({
			start,
			end
		});
	}, [cursor]);
	const weeks = (0, import_react.useMemo)(() => {
		const rows = [];
		for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));
		return rows;
	}, [cells]);
	const bars = (0, import_react.useMemo)(() => {
		return projects.flatMap((project) => project.stages.flatMap((stage, index) => {
			const range = stageRange(project, stage, index);
			if (!range) return [];
			return [{
				projectId: project.id,
				project: project.title,
				stageId: stage.id,
				title: stage.title,
				...range
			}];
		}));
	}, [projects]);
	const dayTasks = tasks.filter((task) => task.due === day).sort(byNewest);
	const letters = [
		"Пн",
		"Вт",
		"Ср",
		"Чт",
		"Пт",
		"Сб",
		"Вс"
	];
	function track(event, initial) {
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startY = event.clientY;
		dragRef.current = initial;
		let frame = 0;
		const tick = () => {
			const current = dragRef.current;
			if (current?.active) nudgeScroll(current.y);
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		const move = (ev) => {
			const active = Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8;
			const next = {
				...dragRef.current,
				x: ev.clientX,
				y: ev.clientY,
				over: active ? dayAt(ev.clientX, ev.clientY) : null,
				active
			};
			dragRef.current = next;
			setDrag(next);
		};
		const finish = () => {
			window.cancelAnimationFrame(frame);
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			const current = dragRef.current;
			dragRef.current = null;
			setDrag(null);
			if (!current?.active || !current.over) return;
			if (current.kind === "task") {
				updateTask(current.id, { due: current.over });
				setDay(current.over);
				return;
			}
			const delta = daysBetween(current.origin, current.over);
			if (delta === 0) return;
			placeStage(current.projectId, current.id, shiftIso(current.start, delta), shiftIso(current.end, delta));
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: rootRef,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mb-4 flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl tracking-tight",
					children: formatMonth(cursor)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "icon",
							variant: "ghost",
							"aria-label": "Предыдущий месяц",
							onClick: () => setCursor((value) => addMonths(value, -1)),
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "sm",
							variant: "ghost",
							onClick: () => setCursor(/* @__PURE__ */ new Date()),
							children: "Сегодня"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "icon",
							variant: "ghost",
							"aria-label": "Следующий месяц",
							onClick: () => setCursor((value) => addMonths(value, 1)),
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mb-3 text-sm text-muted",
				children: "Перетащите задачу или этап на другой день."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid grid-cols-7 gap-1 text-center text-xs text-subtle",
				children: letters.map((letter) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "py-2",
					children: letter
				}, letter))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-col gap-2",
				children: weeks.map((week) => {
					const weekStart = todayIso(week[0] ?? /* @__PURE__ */ new Date());
					const weekEnd = todayIso(week[6] ?? /* @__PURE__ */ new Date());
					const rowBars = bars.map((bar) => {
						if (bar.end < weekStart || bar.start > weekEnd) return null;
						const start = bar.start < weekStart ? weekStart : bar.start;
						const end = bar.end > weekEnd ? weekEnd : bar.end;
						return {
							...bar,
							col: daysBetween(weekStart, start),
							span: daysBetween(start, end) + 1
						};
					}).filter((bar) => bar != null);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-7 gap-1",
						children: week.map((date) => {
							const iso = todayIso(date);
							const inMonth = isSameMonth(date, cursor);
							const count = tasks.filter((task) => !task.done && task.due === iso).length;
							const selected = iso === day;
							const isToday = iso === today;
							const over = drag?.active && drag.over === iso;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								"data-day": iso,
								onClick: () => setDay(iso),
								className: cn("flex h-14 flex-col items-center justify-center rounded-md text-sm", selected ? "bg-elevated" : "hover:bg-elevated", inMonth ? "text-fg" : "text-subtle", over && "bg-accent text-accent-fg"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: cn("flex size-7 items-center justify-center rounded-full tabular-nums", isToday && !over && "bg-accent text-accent-fg"),
									children: date.getDate()
								}), count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-xs tabular-nums text-muted",
									children: count
								}) : null]
							}, iso);
						})
					}), rowBars.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-1 flex flex-col gap-1",
						children: rowBars.map((bar) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "grid grid-cols-7 gap-1",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								role: "button",
								tabIndex: 0,
								"aria-label": `${bar.project}, этап ${bar.title}`,
								onPointerDown: (event) => {
									if (event.button !== 0) return;
									const origin = dayAt(event.clientX, event.clientY) ?? bar.start;
									track(event, {
										kind: "stage",
										id: bar.stageId,
										projectId: bar.projectId,
										title: `${bar.project} · ${bar.title}`,
										origin,
										start: bar.start,
										end: bar.end,
										x: event.clientX,
										y: event.clientY,
										over: null,
										active: false
									});
								},
								onKeyDown: (event) => {
									if (event.key === "Enter" || event.key === " ") setDay(bar.start);
								},
								className: "drag-handle flex h-11 items-center overflow-hidden rounded-md border border-line bg-elevated px-2 text-left text-xs text-fg",
								style: { gridColumn: `${bar.col + 1} / span ${bar.span}` },
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "truncate",
									children: [
										bar.project,
										" · ",
										bar.title
									]
								})
							})
						}, `${bar.stageId}-${weekStart}`))
					}) : null] }, weekStart);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-xl tracking-tight",
						children: formatLong(day)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddTaskForm, {
							placeholder: "Встреча в 15",
							onAdd: (title) => addTask({
								title,
								due: day,
								listId: null
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3",
						children: dayTasks.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "py-8 text-sm text-muted",
							children: "На этот день задач нет. Можно перетащить сюда задачу с другого дня."
						}) : dayTasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
							task,
							today,
							selected: selectedId === task.id,
							showDue: false,
							showList: true,
							onOpen,
							onDragStart: (event) => {
								if (event.button !== 0) return;
								track(event, {
									kind: "task",
									id: task.id,
									title: task.title,
									x: event.clientX,
									y: event.clientY,
									over: null,
									active: false
								});
							}
						}, task.id))
					})
				]
			}),
			drag?.active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg",
				style: {
					left: drag.x + 16,
					top: drag.y + 16
				},
				children: drag.title
			}) : null
		]
	});
}
function ChecklistView({ selectedId, onOpen }) {
	const tasks = usePlanner((s) => s.tasks);
	const addTask = usePlanner((s) => s.addTask);
	const today = todayIso();
	const [bulk, setBulk] = (0, import_react.useState)("");
	const open = tasks.filter((task) => !task.done).sort(byNewest);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "rounded-lg border border-line bg-elevated p-3",
		onSubmit: (event) => {
			event.preventDefault();
			const lines = bulk.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 20);
			for (const title of lines) addTask({
				title,
				listId: null,
				due: null
			});
			setBulk("");
		},
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
			className: "block text-xs font-medium text-subtle",
			children: ["Несколько дел — каждое с новой строки", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
				value: bulk,
				onChange: (event) => setBulk(event.target.value),
				rows: 4,
				placeholder: "Купить хлеб\nПозвонить маме\nОтправить счёт",
				className: "mt-2 w-full resize-y rounded-md border border-line bg-surface px-3 py-3 text-sm text-fg outline-none placeholder:text-subtle"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			type: "submit",
			variant: "primary",
			className: "mt-3",
			disabled: !bulk.trim(),
			children: "Добавить в список"
		})]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-4",
		children: open.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "py-10 text-center text-sm text-muted",
			children: "Список дел пуст."
		}) : open.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
			task,
			today,
			selected: selectedId === task.id,
			showDue: true,
			showList: true,
			onOpen
		}, task.id))
	})] });
}
var KINDS = [
	{
		id: "birthday",
		label: "День рождения"
	},
	{
		id: "anniversary",
		label: "Годовщина"
	},
	{
		id: "holiday",
		label: "Праздник"
	},
	{
		id: "other",
		label: "Другое"
	}
];
function DatesView() {
	const milestones = usePlanner((s) => s.milestones) ?? [];
	const addMilestone = usePlanner((s) => s.addMilestone);
	const updateMilestone = usePlanner((s) => s.updateMilestone);
	const deleteMilestone = usePlanner((s) => s.deleteMilestone);
	const today = todayIso();
	const [title, setTitle] = (0, import_react.useState)("");
	const [date, setDate] = (0, import_react.useState)(today);
	const [yearly, setYearly] = (0, import_react.useState)(true);
	const [kind, setKind] = (0, import_react.useState)("birthday");
	const [time, setTime] = (0, import_react.useState)("09:00");
	const rows = milestones.map((item) => {
		const when = nextOccurrence(item.date, item.yearly, today);
		return {
			item,
			when,
			days: daysBetween(today, when)
		};
	}).sort((a, b) => a.days - b.days);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
		className: "divide-y divide-line",
		children: [rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
			className: "py-8 text-sm text-muted",
			children: "Пока нет важных дат."
		}) : null, rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
			className: "flex flex-col gap-2 py-3 sm:flex-row sm:items-center",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex min-w-0 flex-1 items-center gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "w-16 shrink-0 text-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-2xl tabular-nums leading-none",
						children: Math.max(0, row.days)
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-subtle",
						children: "дн."
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0 flex-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm font-medium",
						children: row.item.title
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs text-muted",
						children: [
							formatLong(row.when),
							" · ",
							countdownLabel(row.days),
							row.item.yearly ? " · каждый год" : "",
							row.item.remindAt ? ` · в ${row.item.remindAt}` : ""
						]
					})]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					type: "time",
					value: row.item.remindAt ?? "",
					"aria-label": `Напомнить, ${row.item.title}`,
					onChange: (event) => updateMilestone(row.item.id, { remindAt: event.target.value || null }),
					className: "h-11 w-36 shrink-0 rounded-md border border-line bg-elevated px-3 text-sm"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "ghost",
					className: "text-danger",
					onClick: () => deleteMilestone(row.item.id),
					children: "Удалить"
				})]
			})]
		}, row.item.id))]
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		className: "mt-6 grid gap-3 rounded-lg border border-line bg-elevated p-3",
		onSubmit: (event) => {
			event.preventDefault();
			addMilestone({
				title,
				date,
				yearly,
				kind,
				remindAt: time || null
			});
			setTitle("");
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium text-subtle",
				children: "Новая дата"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: title,
				onChange: (event) => setTitle(event.target.value),
				placeholder: "Название",
				"aria-label": "Название даты",
				className: "h-11 rounded-md border border-line bg-surface px-3 text-sm outline-none placeholder:text-subtle"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					type: "date",
					value: date,
					onChange: (event) => setDate(event.target.value),
					"aria-label": "Дата",
					className: "h-11 rounded-md border border-line bg-surface px-3 text-sm"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
					value: kind,
					onChange: (event) => setKind(event.target.value),
					"aria-label": "Тип даты",
					className: "h-11 rounded-md border border-line bg-surface px-3 text-sm",
					children: KINDS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: item.id,
						children: item.label
					}, item.id))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				type: "time",
				value: time,
				onChange: (event) => setTime(event.target.value),
				"aria-label": "Время напоминания",
				className: "h-11 rounded-md border border-line bg-surface px-3 text-sm"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "flex h-11 items-center gap-2 text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					type: "checkbox",
					checked: yearly,
					onChange: (event) => setYearly(event.target.checked)
				}), "Повторять каждый год"]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				variant: "primary",
				disabled: !title.trim() || !date,
				children: "Добавить дату"
			})
		]
	})] });
}
function isImportant(task) {
	return typeof task.important === "boolean" ? task.important : task.priority >= 2;
}
function isUrgent(task) {
	return typeof task.urgent === "boolean" ? task.urgent : task.priority >= 3;
}
var LEVELS = [
	{
		value: 0,
		label: "Нет"
	},
	{
		value: 1,
		label: "Низкий"
	},
	{
		value: 2,
		label: "Средний"
	},
	{
		value: 3,
		label: "Высокий"
	}
];
function TaskDetail({ taskId, onClose }) {
	const task = usePlanner((s) => s.tasks.find((item) => item.id === taskId));
	const lists = usePlanner((s) => s.lists);
	const updateTask = usePlanner((s) => s.updateTask);
	const deleteTask = usePlanner((s) => s.deleteTask);
	const addSubtask = usePlanner((s) => s.addSubtask);
	const toggleSubtask = usePlanner((s) => s.toggleSubtask);
	const deleteSubtask = usePlanner((s) => s.deleteSubtask);
	const [tag, setTag] = (0, import_react.useState)("");
	const [sub, setSub] = (0, import_react.useState)("");
	const [confirm, setConfirm] = (0, import_react.useState)(false);
	if (!task) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-full min-h-0 flex-col",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-center gap-2 px-3 py-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "px-2 text-sm text-muted",
				children: "Задача"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				className: "ml-auto",
				size: "icon",
				variant: "ghost",
				"aria-label": "Закрыть",
				onClick: onClose,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" })
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "min-h-0 flex-1 overflow-y-auto px-4 pb-8",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: task.title,
					"aria-label": "Название",
					onChange: (event) => updateTask(task.id, { title: event.target.value }),
					onBlur: () => {
						if (!task.title.trim()) updateTask(task.id, { title: "Без названия" });
					},
					className: "w-full bg-transparent font-display text-3xl tracking-tight text-fg outline-none"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "mt-6 block text-xs font-medium text-subtle",
					children: ["Заметка", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
						value: task.notes,
						onChange: (event) => updateTask(task.id, { notes: event.target.value }),
						rows: 4,
						placeholder: "Контекст, ссылки, что не забыть",
						className: "mt-2 w-full resize-y rounded-md border border-line bg-elevated px-3 py-3 text-base font-normal leading-normal text-fg outline-none placeholder:text-subtle"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", {
					className: "mt-5",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", {
						className: "text-xs font-medium text-subtle",
						children: "Приоритет"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-2 grid grid-cols-4 gap-1",
						children: LEVELS.map((level) => {
							const active = task.priority === level.value;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-pressed": active,
								onClick: () => updateTask(task.id, { priority: level.value }),
								className: cn("h-11 rounded-md border text-xs font-medium", active ? "border-current" : "border-line text-muted", active && level.value === 3 && "text-danger", active && level.value === 2 && "text-warn", active && level.value === 1 && "text-accent", active && level.value === 0 && "text-fg"),
								children: level.label
							}, level.value);
						})
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-3 grid grid-cols-2 gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-pressed": isImportant(task),
						onClick: () => updateTask(task.id, { important: !isImportant(task) }),
						className: cn("h-11 rounded-md border text-sm", isImportant(task) ? "border-accent font-medium text-fg" : "border-line text-muted"),
						children: "Важно"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						"aria-pressed": isUrgent(task),
						onClick: () => updateTask(task.id, { urgent: !isUrgent(task) }),
						className: cn("h-11 rounded-md border text-sm", isUrgent(task) ? "border-danger font-medium text-danger" : "border-line text-muted"),
						children: "Срочно"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle",
							children: ["Дата", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "date",
								value: task.due ?? "",
								onChange: (event) => updateTask(task.id, { due: event.target.value || null }),
								className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle",
							children: [
								"Повтор",
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: task.repeat ?? "",
									onChange: (event) => {
										const repeat = event.target.value || null;
										updateTask(task.id, {
											repeat,
											due: repeat && !task.due ? todayIso() : task.due
										});
									},
									className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "Не повторять"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "day",
											children: repeatLabel("day")
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "weekdays",
											children: repeatLabel("weekdays")
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "week",
											children: repeatLabel("week")
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "month",
											children: repeatLabel("month")
										})
									]
								}),
								task.repeat ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mt-2 block font-normal text-muted",
									children: "Галочка ставит следующую дату, а не в архив."
								}) : null
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle",
							children: ["Напомнить", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "time",
								value: task.remindAt ?? "",
								onChange: (event) => {
									const remindAt = event.target.value || null;
									updateTask(task.id, {
										remindAt,
										due: remindAt && !task.due ? todayIso() : task.due
									});
								},
								className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle",
							children: ["Начало", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "time",
								value: task.startAt ?? "",
								onChange: (event) => {
									const startAt = event.target.value || null;
									updateTask(task.id, {
										startAt,
										due: startAt && !task.due ? todayIso() : task.due
									});
								},
								className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle",
							children: ["Конец", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "time",
								value: task.endAt ?? "",
								onChange: (event) => {
									const endAt = event.target.value || null;
									updateTask(task.id, {
										endAt,
										due: endAt && !task.due ? todayIso() : task.due
									});
								},
								className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "block text-xs font-medium text-subtle sm:col-span-2 lg:col-span-1",
							children: ["Список", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: task.listId ?? "",
								onChange: (event) => updateTask(task.id, { listId: event.target.value || null }),
								className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base font-normal text-fg",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "",
									children: "Входящие"
								}), lists.map((list) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: list.id,
									children: list.name
								}, list.id))]
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-5",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium text-subtle",
							children: "Теги"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-2 flex flex-wrap gap-2",
							children: task.tags.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => updateTask(task.id, { tags: task.tags.filter((tagName) => tagName !== item) }),
								className: "h-8 rounded-full border border-line bg-elevated px-3 text-xs text-fg",
								children: [
									"#",
									item,
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "sr-only",
										children: " убрать"
									})
								]
							}, item))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("form", {
							className: "mt-2",
							onSubmit: (event) => {
								event.preventDefault();
								const next = tag.trim().toLowerCase();
								if (!next || task.tags.includes(next)) {
									setTag("");
									return;
								}
								updateTask(task.id, { tags: [...task.tags, next] });
								setTag("");
							},
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: tag,
								onChange: (event) => setTag(event.target.value),
								placeholder: "Добавить тег",
								"aria-label": "Добавить тег",
								className: "h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
							})
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium text-subtle",
							children: "Подзадачи"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-2",
							children: task.subtasks.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "flex items-center gap-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									"aria-pressed": item.done,
									onClick: () => toggleSubtask(task.id, item.id),
									className: "flex h-11 min-w-0 flex-1 items-center gap-3 text-left text-sm",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("flex size-4 shrink-0 items-center justify-center rounded-full border", item.done ? "border-accent bg-accent" : "border-line") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: item.done ? "text-subtle line-through" : "text-fg",
										children: item.title
									})]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									size: "icon",
									variant: "ghost",
									"aria-label": `Удалить подзадачу ${item.title}`,
									onClick: () => deleteSubtask(task.id, item.id),
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
								})]
							}, item.id))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("form", {
							className: "mt-1",
							onSubmit: (event) => {
								event.preventDefault();
								addSubtask(task.id, sub);
								setSub("");
							},
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: sub,
								onChange: (event) => setSub(event.target.value),
								placeholder: "Новая подзадача",
								"aria-label": "Новая подзадача",
								className: "h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
							})
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-8",
					children: confirm ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "soft",
							onClick: () => setConfirm(false),
							children: "Отмена"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "destructive",
							onClick: () => {
								deleteTask(task.id);
								onClose();
							},
							children: "Удалить"
						})]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "ghost",
						className: "text-danger",
						onClick: () => setConfirm(true),
						children: "Удалить задачу"
					})
				})
			]
		})]
	});
}
var PRESETS = [
	{
		label: "25 мин",
		work: 1500
	},
	{
		label: "50 мин",
		work: 3e3
	},
	{
		label: "15 мин",
		work: 900
	}
];
function formatClock(total) {
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function FocusView() {
	const tasks = usePlanner((s) => s.tasks);
	const toggleTask = usePlanner((s) => s.toggleTask);
	const pomoDate = usePlanner((s) => s.pomoDate);
	const pomoCount = usePlanner((s) => s.pomoCount);
	const focus = usePlanner((s) => s.focus);
	const startFocus = usePlanner((s) => s.startFocus);
	const pauseFocus = usePlanner((s) => s.pauseFocus);
	const resetFocus = usePlanner((s) => s.resetFocus);
	const setWorkLen = usePlanner((s) => s.setWorkLen);
	const setFocusTask = usePlanner((s) => s.setFocusTask);
	const sessions = pomoDate === todayIso() ? pomoCount : 0;
	const total = focus.mode === "work" ? focus.workLen : breakFor(focus.workLen);
	const openTasks = tasks.filter((task) => !task.done);
	const radius = 88;
	const circ = 2 * Math.PI * radius;
	const offset = circ * (1 - (total === 0 ? 0 : focus.seconds / total));
	const label = focus.running ? "Пауза" : focus.seconds < total ? "Дальше" : "Старт";
	const linked = tasks.find((task) => task.id === focus.taskId);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto flex w-full max-w-md flex-col items-center py-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap justify-center gap-2",
				children: PRESETS.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": focus.workLen === preset.work && focus.mode === "work",
					onClick: () => setWorkLen(preset.work),
					className: cn("h-11 rounded-full border px-4 text-sm", focus.workLen === preset.work ? "border-accent bg-accent text-accent-fg" : "border-line text-muted"),
					children: preset.label
				}, preset.label))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative mt-8 size-64",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
					viewBox: "0 0 200 200",
					className: "size-full",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
						cx: "100",
						cy: "100",
						r: radius,
						fill: "none",
						className: "stroke-line",
						strokeWidth: "8"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
						cx: "100",
						cy: "100",
						r: radius,
						fill: "none",
						className: "stroke-accent",
						strokeWidth: "8",
						strokeLinecap: "round",
						strokeDasharray: circ,
						strokeDashoffset: offset,
						transform: "rotate(-90 100 100)"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "absolute inset-0 flex flex-col items-center justify-center",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-subtle",
						children: focus.mode === "work" ? "Фокус" : "Перерыв"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-display text-5xl tabular-nums tracking-tight",
						children: formatClock(focus.seconds)
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-6 flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "primary",
					onClick: () => focus.running ? pauseFocus() : startFocus(),
					children: label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "soft",
					onClick: resetFocus,
					children: "Сброс"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-4 text-sm text-muted",
				children: ["Сессии сегодня: ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "tabular-nums text-fg",
					children: sessions
				})]
			}),
			focus.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-center text-sm text-fg",
				children: focus.note
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "mt-8 block w-full text-xs font-medium text-subtle",
				children: ["Задача сессии", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
					value: focus.taskId ?? "",
					onChange: (event) => setFocusTask(event.target.value || null),
					className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-sm font-normal text-fg",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: "",
						children: "Без задачи"
					}), openTasks.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: task.id,
						children: task.title
					}, task.id))]
				})]
			}),
			linked && !linked.done ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				className: "mt-3",
				variant: "soft",
				onClick: () => toggleTask(linked.id),
				children: "Отметить выполненной"
			}) : null
		]
	});
}
function formatFocusClock(total) {
	return formatClock(total);
}
function streakOf(checks, today) {
	const set = new Set(checks);
	let cursor = today;
	if (!set.has(today)) {
		const yesterday = shiftIso(today, -1);
		if (!set.has(yesterday)) return 0;
		cursor = yesterday;
	}
	let count = 0;
	while (set.has(cursor)) {
		count += 1;
		cursor = shiftIso(cursor, -1);
	}
	return count;
}
function HabitsView() {
	const habits = usePlanner((s) => s.habits);
	const toggleHabit = usePlanner((s) => s.toggleHabit);
	const addHabit = usePlanner((s) => s.addHabit);
	const deleteHabit = usePlanner((s) => s.deleteHabit);
	const today = todayIso();
	const [offset, setOffset] = (0, import_react.useState)(0);
	const [confirmId, setConfirmId] = (0, import_react.useState)(null);
	const days = weekDays(shiftIso(today, offset * 7));
	const doneToday = habits.filter((habit) => habit.checks.includes(today)).length;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-end justify-between gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-sm text-muted",
				children: [
					"Сегодня",
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "tabular-nums text-fg",
						children: [
							doneToday,
							" из ",
							habits.length
						]
					})
				]
			}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "icon",
						variant: "ghost",
						"aria-label": "Прошлая неделя",
						onClick: () => setOffset((n) => n - 1),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "ghost",
						onClick: () => setOffset(0),
						disabled: offset === 0,
						children: "Эта неделя"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "icon",
						variant: "ghost",
						"aria-label": "Следующая неделя",
						onClick: () => setOffset((n) => n + 1),
						disabled: offset >= 0,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
					})
				]
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "mt-4 divide-y divide-line",
			children: habits.map((habit) => {
				const streak = streakOf(habit.checks, today);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "py-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm font-medium",
								children: habit.name
							}),
							habit.why ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-muted",
								children: habit.why
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-subtle",
								children: ["серия ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "tabular-nums",
									children: streak
								})]
							})
						] }), confirmId === habit.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							variant: "destructive",
							size: "sm",
							onClick: () => {
								deleteHabit(habit.id);
								setConfirmId(null);
							},
							children: "Удалить"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							size: "icon",
							variant: "ghost",
							"aria-label": `Удалить привычку ${habit.name}`,
							onClick: () => setConfirmId(habit.id),
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" })
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3 grid grid-cols-7 gap-1",
						children: days.map((day) => {
							const on = habit.checks.includes(day);
							const future = day > today;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								disabled: future,
								"aria-pressed": on,
								"aria-label": `${habit.name}, ${day}`,
								onClick: () => toggleHabit(habit.id, day),
								className: cn("flex h-12 flex-col items-center justify-center rounded-md text-xs tabular-nums", on ? "bg-accent text-accent-fg" : "bg-elevated text-muted", day === today && !on && "ring-1 ring-accent", future && "opacity-40"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: weekdayLetter(day) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: dayNumber(day) })]
							}, day);
						})
					})]
				}, habit.id);
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
			className: "mt-4 flex items-center gap-2",
			onSubmit: (event) => {
				event.preventDefault();
				const data = new FormData(event.currentTarget);
				addHabit(String(data.get("name") ?? ""));
				event.currentTarget.reset();
			},
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				name: "name",
				"aria-label": "Новая привычка",
				placeholder: "Новая привычка",
				className: "h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				variant: "primary",
				children: "Добавить"
			})]
		})
	] });
}
var QUADS = [
	{
		title: "Сделать",
		hint: "важно и срочно",
		important: true,
		urgent: true
	},
	{
		title: "Запланировать",
		hint: "важно, не горит",
		important: true,
		urgent: false
	},
	{
		title: "Быстро",
		hint: "горит, но не важно",
		important: false,
		urgent: true
	},
	{
		title: "Потом",
		hint: "не важно и не горит",
		important: false,
		urgent: false
	}
];
function MatrixView({ selectedId, onOpen }) {
	const tasks = usePlanner((s) => s.tasks);
	const updateTask = usePlanner((s) => s.updateTask);
	const today = todayIso();
	const open = tasks.filter((task) => !task.done);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "grid gap-3 md:grid-cols-2",
		children: QUADS.map((quad) => {
			const items = open.filter((task) => isImportant(task) === quad.important && isUrgent(task) === quad.urgent);
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-lg border border-line bg-elevated p-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-sm font-medium",
						children: quad.title
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-subtle",
						children: quad.hint
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
						className: "mt-3 space-y-2",
						children: [items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
							className: "py-4 text-sm text-muted",
							children: "Пусто"
						}) : null, items.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MatrixCard, {
							task,
							today,
							selected: selectedId === task.id,
							onOpen,
							onFlag: (patch) => updateTask(task.id, patch)
						}) }, task.id))]
					})
				]
			}, quad.title);
		})
	});
}
function MatrixCard({ task, today, selected, onOpen, onFlag }) {
	const overdue = task.due != null && task.due < today;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: cn("rounded-md border border-line px-2 py-2", selected && "bg-surface"),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
			type: "button",
			onClick: () => onOpen(task.id),
			className: "w-full text-left text-sm",
			children: [task.title, task.due ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: cn("mt-1 block text-xs", overdue ? "text-danger" : "text-muted"),
				children: task.due
			}) : null]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-2 flex gap-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-pressed": isImportant(task),
				onClick: () => onFlag({ important: !isImportant(task) }),
				className: cn("h-11 rounded-md border px-3 text-xs", isImportant(task) ? "border-accent text-fg" : "border-line text-subtle"),
				children: "Важно"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-pressed": isUrgent(task),
				onClick: () => onFlag({ urgent: !isUrgent(task) }),
				className: cn("h-11 rounded-md border px-3 text-xs", isUrgent(task) ? "border-danger text-danger" : "border-line text-subtle"),
				children: "Срочно"
			})]
		})]
	});
}
function spanLabel(project) {
	if (project.start && project.end) return `${formatShort(project.start)} — ${formatShort(project.end)}`;
	if (project.start) return `с ${formatShort(project.start)}`;
	if (project.end) return `до ${formatShort(project.end)}`;
	return "Без дат";
}
function progress(project) {
	const cards = project.stages.flatMap((stage) => stage.cards);
	if (cards.length === 0) return "Пока пусто";
	const last = project.stages[project.stages.length - 1];
	return `${last ? last.cards.length : 0} из ${cards.length} на последнем этапе`;
}
function ProjectsView({ initialId = null }) {
	const projects = usePlanner((s) => s.projects) ?? [];
	const addProject = usePlanner((s) => s.addProject);
	const updateProject = usePlanner((s) => s.updateProject);
	const deleteProject = usePlanner((s) => s.deleteProject);
	const addStage = usePlanner((s) => s.addStage);
	const renameStage = usePlanner((s) => s.renameStage);
	const deleteStage = usePlanner((s) => s.deleteStage);
	const addCard = usePlanner((s) => s.addCard);
	const moveCard = usePlanner((s) => s.moveCard);
	const deleteCard = usePlanner((s) => s.deleteCard);
	const [openId, setOpenId] = (0, import_react.useState)(initialId);
	const [name, setName] = (0, import_react.useState)("");
	const [stageName, setStageName] = (0, import_react.useState)("");
	const [confirm, setConfirm] = (0, import_react.useState)(false);
	const [over, setOver] = (0, import_react.useState)(null);
	const [ghost, setGhost] = (0, import_react.useState)(null);
	const scrollerRef = (0, import_react.useRef)(null);
	const project = projects.find((item) => item.id === openId) ?? null;
	function beginCard(event, card, fromStage) {
		if (!project || event.button !== 0) return;
		if (event.target.closest("[data-nodrag]")) return;
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startY = event.clientY;
		let active = false;
		let target = fromStage;
		const move = (ev) => {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) active = true;
			target = (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-stage]"))?.getAttribute("data-stage") ?? fromStage;
			setOver(active ? target : null);
			setGhost(active ? {
				title: card.title,
				x: ev.clientX,
				y: ev.clientY
			} : null);
			const scroller = scrollerRef.current;
			if (scroller && active) {
				const rect = scroller.getBoundingClientRect();
				if (ev.clientX < rect.left + 36) scroller.scrollLeft -= 18;
				else if (ev.clientX > rect.right - 36) scroller.scrollLeft += 18;
			}
		};
		const finish = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			if (active && target !== fromStage) moveCard(project.id, card.id, target);
			setOver(null);
			setGhost(null);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	}
	if (!project) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto flex w-full max-w-3xl flex-col gap-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
			className: "flex gap-2",
			onSubmit: (event) => {
				event.preventDefault();
				const id = addProject(name);
				setName("");
				if (name.trim()) setOpenId(id);
			},
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: name,
				onChange: (event) => setName(event.target.value),
				placeholder: "Новый проект",
				"aria-label": "Новый проект",
				className: "h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				variant: "primary",
				disabled: !name.trim(),
				children: "Создать"
			})]
		}), projects.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "px-2 py-16 text-center",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "font-display text-2xl tracking-tight",
				children: "Пока нет проектов"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Проект длиннее одного дня. Карточку перетащите в другой этап."
			})]
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "flex flex-col gap-2",
			children: projects.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: () => {
					setConfirm(false);
					setOpenId(item.id);
				},
				className: "flex w-full flex-col items-start rounded-lg border border-line bg-elevated px-4 py-3 text-left",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-sm font-medium",
						children: item.title
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "mt-1 text-xs text-muted",
						children: spanLabel(item)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-xs text-subtle",
						children: progress(item)
					})
				]
			}) }, item.id))
		})]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					size: "icon",
					variant: "ghost",
					"aria-label": "К списку проектов",
					onClick: () => {
						setOpenId(null);
						setConfirm(false);
					},
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					"aria-label": "Название проекта",
					value: project.title,
					onChange: (event) => updateProject(project.id, { title: event.target.value }),
					onBlur: () => {
						if (!project.title.trim()) updateProject(project.id, { title: "Без названия" });
					},
					className: "min-w-0 flex-1 bg-transparent font-display text-3xl tracking-tight outline-none"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "block text-xs font-medium text-subtle",
					children: ["Начало", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "date",
						value: project.start ?? "",
						onChange: (event) => updateProject(project.id, { start: event.target.value || null }),
						className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "block text-xs font-medium text-subtle",
					children: ["Конец", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "date",
						value: project.end ?? "",
						onChange: (event) => updateProject(project.id, { end: event.target.value || null }),
						className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: "Потяните карточку в другой этап."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				ref: scrollerRef,
				className: "flex gap-2 overflow-x-auto pb-2",
				children: project.stages.map((stage) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					"data-stage": stage.id,
					className: cn("flex w-64 shrink-0 snap-start flex-col rounded-lg border bg-bg p-3", over === stage.id ? "border-accent" : "border-line"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							"aria-label": `Этап ${stage.title}`,
							value: stage.title,
							onChange: (event) => renameStage(project.id, stage.id, event.target.value),
							className: "h-11 w-full bg-transparent text-sm font-medium outline-none"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-2 flex min-h-16 flex-col gap-2",
							children: stage.cards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "drag-handle flex items-start gap-2 rounded-md border border-line bg-elevated p-3",
								onPointerDown: (event) => beginCard(event, card, stage.id),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "min-w-0 flex-1 py-2 text-sm",
									children: card.title
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									"data-nodrag": "",
									"aria-label": `Удалить ${card.title}`,
									onPointerDown: (event) => event.stopPropagation(),
									onClick: () => deleteCard(project.id, card.id),
									className: "flex size-11 shrink-0 items-center justify-center text-subtle",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
								})]
							}) }, card.id))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("form", {
							className: "mt-2",
							onSubmit: (event) => {
								event.preventDefault();
								const data = new FormData(event.currentTarget);
								addCard(project.id, stage.id, String(data.get("title") ?? ""));
								event.currentTarget.reset();
							},
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								name: "title",
								placeholder: "Карточка",
								"aria-label": `Карточка в ${stage.title}`,
								className: "h-11 w-full rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
							})
						}),
						project.stages.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => deleteStage(project.id, stage.id),
							className: "mt-2 h-11 text-left text-xs text-muted",
							children: "Убрать этап"
						}) : null
					]
				}, stage.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "flex gap-2",
				onSubmit: (event) => {
					event.preventDefault();
					addStage(project.id, stageName);
					setStageName("");
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: stageName,
					onChange: (event) => setStageName(event.target.value),
					placeholder: "Новый этап",
					"aria-label": "Новый этап",
					className: "h-11 min-w-0 flex-1 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					type: "submit",
					variant: "soft",
					disabled: !stageName.trim(),
					children: "Этап"
				})]
			}),
			confirm ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "soft",
					onClick: () => setConfirm(false),
					children: "Отмена"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					variant: "destructive",
					onClick: () => {
						deleteProject(project.id);
						setOpenId(null);
						setConfirm(false);
					},
					children: "Удалить проект"
				})]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "ghost",
				className: "self-start text-danger",
				onClick: () => setConfirm(true),
				children: "Удалить проект"
			}),
			ghost ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg",
				style: {
					left: ghost.x + 12,
					top: ghost.y + 12
				},
				children: ghost.title
			}) : null
		]
	});
}
function beep() {
	try {
		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = 620;
		gain.gain.value = .03;
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start();
		gain.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + .35);
		osc.stop(ctx.currentTime + .4);
		window.setTimeout(() => void ctx.close(), 600);
	} catch {}
}
function localStamp(day, time) {
	const [y, m, d] = day.split("-").map(Number);
	const [h, min] = time.split(":").map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0, 0, 0).getTime();
}
function validTime(value) {
	return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function kindLabel(kind) {
	if (kind === "habit") return "Привычка";
	if (kind === "date") return "Дата";
	return "Задача";
}
function collectReminders(input) {
	const today = todayIso(new Date(input.now));
	const tomorrowEnd = localStamp(shiftIso(today, 1), "23:59");
	const ack = input.remindAck ?? {};
	const hits = [];
	for (const task of input.tasks) {
		if (task.done || !validTime(task.remindAt) || !task.due) continue;
		const at = localStamp(task.due, task.remindAt);
		if (task.due > shiftIso(today, 1)) continue;
		const stamp = `${task.due}T${task.remindAt}`;
		const key = `task:${task.id}`;
		const status = at <= input.now ? "due" : "later";
		if (status === "due" && ack[key] === stamp) continue;
		hits.push({
			key,
			stamp,
			kind: "task",
			refId: task.id,
			title: task.title,
			time: task.remindAt,
			whenLabel: `${dueLabel(task.due, today)} в ${task.remindAt}`,
			at,
			status
		});
	}
	for (const item of input.milestones) {
		if (!validTime(item.remindAt)) continue;
		const when = nextOccurrence(item.date, item.yearly, today);
		const days = daysBetween(today, when);
		if (days < 0 || days > 1) continue;
		const at = localStamp(when, item.remindAt);
		if (at > tomorrowEnd) continue;
		const stamp = `${when}T${item.remindAt}`;
		const key = `date:${item.id}`;
		const status = at <= input.now ? "due" : "later";
		if (status === "due" && ack[key] === stamp) continue;
		hits.push({
			key,
			stamp,
			kind: "date",
			refId: item.id,
			title: item.title,
			time: item.remindAt,
			whenLabel: `${dueLabel(when, today)} в ${item.remindAt}`,
			at,
			status
		});
	}
	hits.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, "ru"));
	return hits;
}
function notifyReminder(hit) {
	if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
	try {
		new Notification(hit.title, {
			body: hit.whenLabel,
			tag: hit.key
		});
	} catch {}
}
function useReminderHits() {
	const tasks = usePlanner((s) => s.tasks);
	const milestones = usePlanner((s) => s.milestones);
	const remindAck = usePlanner((s) => s.remindAck);
	const [now, setNow] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		setNow(Date.now());
	}, [
		tasks,
		milestones,
		remindAck
	]);
	(0, import_react.useEffect)(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1e4);
		return () => window.clearInterval(id);
	}, []);
	if (now == null) return [];
	return collectReminders({
		tasks,
		milestones: milestones ?? [],
		remindAck: remindAck ?? {},
		now
	});
}
function useReminderChime(due) {
	const startedAt = (0, import_react.useRef)(0);
	const seen = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	const dueRef = (0, import_react.useRef)(due);
	dueRef.current = due;
	const signature = due.map((hit) => `${hit.key}:${hit.stamp}`).join("|");
	(0, import_react.useEffect)(() => {
		if (startedAt.current === 0) startedAt.current = Date.now();
		for (const hit of dueRef.current) {
			const id = `${hit.key}:${hit.stamp}`;
			if (seen.current.has(id)) continue;
			seen.current.add(id);
			if (hit.at < startedAt.current - 2e3) continue;
			beep();
			notifyReminder(hit);
		}
	}, [signature]);
}
function ReminderBell({ dueCount, open, onToggle }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
		size: "icon",
		variant: "ghost",
		"aria-expanded": open,
		"aria-label": dueCount > 0 ? `Напоминания, сейчас ${dueCount}` : "Напоминания",
		onClick: onToggle,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "relative",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bell, {
				className: "size-5",
				strokeWidth: 1.75
			}), dueCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs text-on-danger tabular-nums",
				children: dueCount > 9 ? "9" : dueCount
			}) : null]
		})
	});
}
function ReminderPanel({ hits, onOpen, onAck }) {
	const [perm, setPerm] = (0, import_react.useState)("off");
	(0, import_react.useEffect)(() => {
		if (typeof Notification === "undefined") return;
		setPerm(Notification.permission);
	}, []);
	const due = hits.filter((hit) => hit.status === "due");
	const later = hits.filter((hit) => hit.status === "later");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "absolute top-full right-0 z-30 mt-2 w-full max-w-sm rounded-lg border border-line bg-surface p-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium text-subtle",
				children: "Напоминания"
			}),
			hits.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "py-4 text-sm text-muted",
				children: "Пока тихо. Время ставится в задаче, привычке или дате."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "mt-2 max-h-80 overflow-y-auto",
				children: [due.map((hit) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReminderRow, {
					hit,
					onOpen,
					onAck
				}, hit.key)), later.map((hit) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReminderRow, {
					hit,
					onOpen,
					onAck
				}, hit.key))]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-xs text-subtle",
				children: "Звук только пока «Пора» открыта. Утром всё на сегодня — на экране «Сегодня»."
			}),
			perm === "default" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				variant: "soft",
				className: "mt-2 w-full",
				onClick: () => {
					Notification.requestPermission().then((next) => setPerm(next));
				},
				children: "Включить уведомления"
			}) : null,
			perm === "granted" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-xs text-muted",
				children: "Уведомления браузера включены."
			}) : null
		]
	});
}
function ReminderRow({ hit, onOpen, onAck }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "flex items-center gap-2 border-b border-line py-1 last:border-b-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
			type: "button",
			onClick: () => onOpen(hit),
			className: "min-w-0 flex-1 py-1 text-left",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "flex items-baseline gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: cn("w-12 shrink-0 text-xs tabular-nums", hit.status === "due" ? "text-danger" : "text-muted"),
					children: hit.time
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "truncate text-sm text-fg",
					children: hit.title
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "mt-0.5 block pl-14 text-xs text-subtle",
				children: [
					kindLabel(hit.kind),
					" · ",
					hit.whenLabel
				]
			})]
		}), hit.status === "due" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			variant: "ghost",
			className: "shrink-0 text-muted",
			onClick: () => onAck(hit),
			children: "Понятно"
		}) : null]
	});
}
function ReminderBanner({ due, onOpen, onAck, onMore }) {
	const hit = due[0];
	if (!hit) return null;
	const extra = due.length - 1;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-11 shrink-0 items-center gap-2 border-b border-line bg-elevated px-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: () => onOpen(hit),
				className: "flex min-w-0 flex-1 items-center gap-2 text-left",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "w-12 shrink-0 text-xs tabular-nums text-danger",
					children: hit.time
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "truncate text-sm text-fg",
					children: hit.title
				})]
			}),
			extra > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: onMore,
				className: "h-11 shrink-0 px-1 text-xs text-muted",
				children: ["ещё ", extra]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => onAck(hit),
				className: "h-11 shrink-0 px-1 text-xs text-muted",
				children: "Понятно"
			})
		]
	});
}
var BOARD_TO = 1320;
function toMinutes(value) {
	if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
	const [h, m] = value.split(":").map(Number);
	if (h == null || m == null || h > 23 || m > 59) return null;
	return h * 60 + m;
}
function fromMinutes(total) {
	const clamped = Math.max(0, Math.min(1440, total));
	const h = Math.floor(clamped / 60);
	const m = clamped % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function taskSpan(task) {
	const start = toMinutes(task.startAt) ?? toMinutes(task.remindAt);
	if (start == null) return null;
	const explicit = toMinutes(task.endAt);
	const assumed = explicit == null || explicit <= start;
	const end = assumed ? Math.min(start + 60, 1440) : explicit;
	if (end == null || end <= start) return null;
	return {
		id: task.id,
		title: task.title,
		start,
		end,
		done: task.done,
		assumed
	};
}
function placeSpans(spans) {
	const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
	const laneEnds = [];
	const laneOf = /* @__PURE__ */ new Map();
	for (const span of sorted) {
		let lane = laneEnds.findIndex((end) => end <= span.start);
		if (lane < 0) {
			lane = laneEnds.length;
			laneEnds.push(span.end);
		} else laneEnds[lane] = span.end;
		laneOf.set(span.id, lane);
	}
	return spans.map((span) => {
		const overlapping = spans.filter((other) => other.start < span.end && span.start < other.end);
		const used = new Set(overlapping.map((other) => laneOf.get(other.id) ?? 0));
		return {
			...span,
			lane: laneOf.get(span.id) ?? 0,
			lanes: Math.max(used.size, 1),
			clash: overlapping.length > 1
		};
	});
}
function freeWindows(workStart, workEnd, spans) {
	if (workEnd - workStart < 15) return [];
	const clipped = spans.filter((span) => !span.done).map((span) => ({
		start: Math.max(span.start, workStart),
		end: Math.min(span.end, workEnd)
	})).filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
	const merged = [];
	for (const span of clipped) {
		const last = merged[merged.length - 1];
		if (!last || span.start > last.end) merged.push({ ...span });
		else last.end = Math.max(last.end, span.end);
	}
	const gaps = [];
	let cursor = workStart;
	for (const block of merged) {
		if (block.start - cursor >= 15) gaps.push({
			start: cursor,
			end: block.start
		});
		cursor = Math.max(cursor, block.end);
	}
	if (workEnd - cursor >= 15) gaps.push({
		start: cursor,
		end: workEnd
	});
	return gaps;
}
function boardBounds(spans, workStart, workEnd) {
	const points = [
		420,
		BOARD_TO,
		workStart,
		workEnd,
		...spans.flatMap((span) => [span.start, span.end])
	];
	const from = Math.floor(Math.min(...points) / 60) * 60;
	const to = Math.ceil(Math.max(...points) / 60) * 60;
	return {
		from: Math.max(0, from),
		to: Math.min(1440, Math.max(to, from + 60))
	};
}
var HOUR = 4;
function blockStyle(span, from) {
	const minutes = Math.max(span.end - span.start, 15);
	return {
		top: `${(span.start - from) / 60 * HOUR}rem`,
		height: `${Math.max(minutes / 60 * HOUR, 2.75)}rem`,
		left: `calc(3rem + (100% - 3rem) * ${span.lane} / ${span.lanes})`,
		width: `calc((100% - 3rem) / ${span.lanes} - 0.25rem)`
	};
}
function ScheduleView({ onOpen, onOpenProjects }) {
	const tasks = usePlanner((s) => s.tasks);
	const projects = usePlanner((s) => s.projects) ?? [];
	const workStart = usePlanner((s) => s.workStart) ?? "09:00";
	const workEnd = usePlanner((s) => s.workEnd) ?? "18:00";
	const setWorkHours = usePlanner((s) => s.setWorkHours);
	const addTask = usePlanner((s) => s.addTask);
	const updateTask = usePlanner((s) => s.updateTask);
	const today = todayIso();
	const [day, setDay] = (0, import_react.useState)(today);
	const [title, setTitle] = (0, import_react.useState)("");
	const [from, setFrom] = (0, import_react.useState)("14:00");
	const [to, setTo] = (0, import_react.useState)("15:00");
	const [draft, setDraft] = (0, import_react.useState)(null);
	const [preview, setPreview] = (0, import_react.useState)(null);
	const [ghost, setGhost] = (0, import_react.useState)(null);
	const [holding, setHolding] = (0, import_react.useState)(null);
	const draftRef = (0, import_react.useRef)(draft);
	const previewRef = (0, import_react.useRef)(null);
	const boardRef = (0, import_react.useRef)(null);
	const rootRef = (0, import_react.useRef)(null);
	draftRef.current = draft;
	const spans = (0, import_react.useMemo)(() => tasks.filter((task) => task.due === day).map(taskSpan).filter((span) => span != null), [tasks, day]);
	const live = (0, import_react.useMemo)(() => {
		const mapped = spans.map((span) => draft && span.id === draft.id ? {
			...span,
			start: draft.start,
			end: draft.end,
			assumed: false
		} : span);
		if (!preview) return mapped;
		return [...mapped.filter((span) => span.id !== preview.id), {
			id: preview.id,
			title: preview.title,
			start: preview.start,
			end: preview.end,
			done: false,
			assumed: false
		}];
	}, [
		spans,
		draft,
		preview
	]);
	const placed = (0, import_react.useMemo)(() => placeSpans(live), [live]);
	const workFrom = toMinutes(workStart) ?? 540;
	const workTo = toMinutes(workEnd) ?? 1080;
	const hoursOk = workTo > workFrom;
	const gaps = (0, import_react.useMemo)(() => hoursOk ? freeWindows(workFrom, workTo, spans) : [], [
		hoursOk,
		workFrom,
		workTo,
		spans
	]);
	const bounds = (0, import_react.useMemo)(() => boardBounds(spans, workFrom, workTo), [
		spans,
		workFrom,
		workTo
	]);
	const hours = Math.max(1, Math.round((bounds.to - bounds.from) / 60));
	const clashes = placed.filter((span) => span.clash && !span.done);
	const untimed = tasks.filter((task) => task.due === day && !task.done && !taskSpan(task));
	const cards = tasks.filter((task) => task.due === day && !task.done).sort((a, b) => (taskSpan(a)?.start ?? 1440) - (taskSpan(b)?.start ?? 1440));
	const running = projects.filter((project) => {
		if (!project.start || !project.end) return false;
		return project.start <= day && project.end >= day;
	});
	const now = /* @__PURE__ */ new Date();
	const nowMin = now.getHours() * 60 + now.getMinutes();
	const showNow = day === today && nowMin >= bounds.from && nowMin <= bounds.to;
	const rangeOk = (toMinutes(to) ?? 0) > (toMinutes(from) ?? 0);
	function addBlock(event) {
		event.preventDefault();
		if (!title.trim() || !rangeOk) return;
		addTask({
			title,
			listId: null,
			due: day,
			startAt: from,
			endAt: to,
			remindAt: from
		});
		setTitle("");
	}
	function clock(total) {
		return fromMinutes(Math.max(0, Math.min(total, 1439)));
	}
	function beginDrag(event, span, mode) {
		if (event.button !== 0) return;
		event.stopPropagation();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const origin = {
			start: span.start,
			end: span.end
		};
		const boardFrom = bounds.from;
		const boardTo = bounds.to;
		let moved = false;
		const apply = (next) => {
			draftRef.current = next;
			setDraft(next);
		};
		const move = (ev) => {
			const rect = boardRef.current?.getBoundingClientRect();
			if (!rect || rect.height === 0) return;
			const delta = (ev.clientY - startY) / rect.height * (boardTo - boardFrom);
			if (Math.abs(ev.clientY - startY) > 6) moved = true;
			if (mode === "move") {
				const duration = Math.max(origin.end - origin.start, 15);
				let start = Math.round((origin.start + delta) / 15) * 15;
				start = Math.max(boardFrom, Math.min(start, boardTo - duration));
				apply({
					id: span.id,
					start,
					end: start + duration
				});
				return;
			}
			let end = Math.round((origin.end + delta) / 15) * 15;
			end = Math.max(origin.start + 15, Math.min(end, boardTo));
			apply({
				id: span.id,
				start: origin.start,
				end
			});
		};
		const finish = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			const current = draftRef.current;
			draftRef.current = null;
			setDraft(null);
			if (!moved || !current || current.id !== span.id) {
				if (!moved && mode === "move") onOpen(span.id);
				return;
			}
			updateTask(span.id, {
				due: day,
				startAt: clock(current.start),
				endAt: clock(current.end),
				remindAt: clock(current.start)
			});
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	}
	function nudgeScroll(y) {
		let node = rootRef.current?.parentElement ?? null;
		while (node) {
			const overflow = getComputedStyle(node).overflowY;
			if (overflow === "auto" || overflow === "scroll") break;
			node = node.parentElement;
		}
		if (!node) return;
		const rect = node.getBoundingClientRect();
		if (y < rect.top + 64) node.scrollTop -= 18;
		else if (y > rect.bottom - 88) node.scrollTop += 18;
	}
	function beginCard(event, task) {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startY = event.clientY;
		const existing = spans.find((span) => span.id === task.id);
		const duration = existing ? Math.max(existing.end - existing.start, 15) : 60;
		let moved = false;
		const show = (next) => {
			previewRef.current = next;
			setPreview(next);
		};
		const move = (ev) => {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
			if (!moved) return;
			setHolding(task.id);
			setGhost({
				title: task.title,
				x: ev.clientX,
				y: ev.clientY
			});
			nudgeScroll(ev.clientY);
			const gap = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-gap]");
			if (gap?.dataset.gap) {
				const [gapStart, gapEnd] = gap.dataset.gap.split(":").map(Number);
				const room = Math.max((gapEnd ?? 0) - (gapStart ?? 0), 15);
				const length = existing ? Math.min(duration, room) : Math.min(room, 120);
				show({
					id: task.id,
					title: task.title,
					start: gapStart ?? bounds.from,
					end: (gapStart ?? bounds.from) + length
				});
				return;
			}
			const rect = boardRef.current?.getBoundingClientRect();
			if (!(rect != null && ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) || !rect || rect.height === 0) {
				show(null);
				return;
			}
			let start = Math.round((bounds.from + (ev.clientY - rect.top) / rect.height * (bounds.to - bounds.from)) / 15) * 15;
			start = Math.max(bounds.from, Math.min(start, bounds.to - duration));
			show({
				id: task.id,
				title: task.title,
				start,
				end: start + duration
			});
		};
		const finish = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			const current = previewRef.current;
			previewRef.current = null;
			setPreview(null);
			setGhost(null);
			setHolding(null);
			if (!moved) return;
			if (!current) return;
			updateTask(task.id, {
				due: day,
				startAt: clock(current.start),
				endAt: clock(current.end),
				remindAt: clock(current.start)
			});
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: rootRef,
		className: "mx-auto flex w-full max-w-3xl flex-col gap-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "icon",
						variant: "soft",
						"aria-label": "Предыдущий день",
						onClick: () => setDay(shiftIso(day, -1)),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0 flex-1 text-center",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "truncate font-display text-2xl tracking-tight",
							children: formatLong(day)
						}), day !== today ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "h-11 text-xs text-muted",
							onClick: () => setDay(today),
							children: "Вернуться к сегодня"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs text-subtle",
							children: clashes.length > 0 ? "Есть накладка" : "Накладок нет"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "icon",
						variant: "soft",
						"aria-label": "Следующий день",
						onClick: () => setDay(shiftIso(day, 1)),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5" })
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "block text-xs font-medium text-subtle",
					children: ["Работаю с", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "time",
						value: workStart,
						onChange: (event) => setWorkHours(event.target.value || "09:00", workEnd),
						className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "block text-xs font-medium text-subtle",
					children: ["до", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "time",
						value: workEnd,
						onChange: (event) => setWorkHours(workStart, event.target.value || "18:00"),
						className: "mt-2 h-11 w-full rounded-md border border-line bg-elevated px-3 text-base text-fg"
					})]
				})]
			}),
			!hoursOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-danger",
				children: "Конец рабочего дня раньше начала."
			}) : null,
			gaps.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium text-subtle",
				children: "Свободно"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-2 flex flex-wrap gap-2",
				children: gaps.map((gap) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					"data-gap": `${gap.start}:${gap.end}`,
					onClick: () => {
						setFrom(fromMinutes(gap.start));
						setTo(fromMinutes(gap.end));
					},
					className: "h-11 rounded-full border border-line bg-elevated px-3 text-sm tabular-nums text-fg",
					children: [
						fromMinutes(gap.start),
						"–",
						fromMinutes(gap.end)
					]
				}, `${gap.start}-${gap.end}`))
			})] }) : hoursOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "В рабочих часах свободных окон нет."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: addBlock,
				className: "grid gap-2 sm:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: title,
						onChange: (event) => setTitle(event.target.value),
						placeholder: "Задача на это время",
						"aria-label": "Задача на это время",
						className: "h-11 rounded-md border border-line bg-elevated px-3 text-base outline-none placeholder:text-subtle sm:col-span-2"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "time",
							"aria-label": "Начало",
							value: from,
							onChange: (event) => setFrom(event.target.value),
							className: "h-11 rounded-md border border-line bg-elevated px-2 text-base text-fg"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "time",
							"aria-label": "Конец",
							value: to,
							onChange: (event) => setTo(event.target.value),
							className: "h-11 rounded-md border border-line bg-elevated px-2 text-base text-fg"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						variant: "primary",
						disabled: !title.trim() || !rangeOk,
						children: "На доску"
					})
				]
			}),
			!rangeOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-danger",
				children: "Конец раньше начала."
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-xs font-medium text-subtle",
					children: "Карточки"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-1 text-xs text-muted",
					children: ["Потяните карточку за полоску и положите на доску или на свободное окно.", untimed.length > 0 ? ` Без времени: ${untimed.length}.` : ""]
				}),
				cards.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: "На этот день открытых дел нет."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-3 flex flex-col gap-2",
					children: cards.map((task) => {
						const span = placed.find((item) => item.id === task.id);
						const meta = span ? `${fromMinutes(span.start)}–${fromMinutes(Math.min(span.end, 1439))}` : "без времени";
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: cn("flex items-stretch rounded-lg border bg-elevated", span?.clash ? "border-danger" : "border-line", holding === task.id && "opacity-40"),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": `Поставить ${task.title} на доску`,
								className: "drag-handle flex w-11 shrink-0 items-center justify-center text-subtle",
								onPointerDown: (event) => beginCard(event, task),
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GripVertical, { className: "size-4" })
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => onOpen(task.id),
								className: "min-w-0 flex-1 px-2 py-3 text-left",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "block truncate text-sm text-fg",
									children: task.title
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: cn("mt-1 block text-xs tabular-nums", span?.clash ? "text-danger" : "text-muted"),
									children: [
										meta,
										span?.clash ? " · накладка" : "",
										span?.assumed ? " · час" : ""
									]
								})]
							})]
						}, task.id);
					})
				})
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: "На доске потяните блок, чтобы сдвинуть время. Нижний край меняет длину."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				ref: boardRef,
				"data-board": "",
				className: "relative",
				style: { height: `${hours * HOUR}rem` },
				children: [
					Array.from({ length: hours + 1 }, (_, index) => {
						const minute = bounds.from + index * 60;
						if (minute > bounds.to) return null;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "absolute right-0 left-12 border-t border-line",
							style: { top: `${index * HOUR}rem` },
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "absolute -top-2 left-0 w-12 -translate-x-full pr-2 text-right text-xs tabular-nums text-subtle",
								children: fromMinutes(minute)
							})
						}, minute);
					}),
					hoursOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "work-band pointer-events-none absolute right-0 left-12",
						style: {
							top: `${(Math.max(workFrom, bounds.from) - bounds.from) / 60 * HOUR}rem`,
							height: `${(Math.min(workTo, bounds.to) - Math.max(workFrom, bounds.from)) / 60 * HOUR}rem`
						}
					}) : null,
					showNow ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "pointer-events-none absolute right-0 left-12 z-10 h-px bg-danger",
						style: { top: `${(nowMin - bounds.from) / 60 * HOUR}rem` }
					}) : null,
					placed.map((span) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						role: "button",
						tabIndex: 0,
						"aria-label": `${span.title}, ${fromMinutes(span.start)}–${fromMinutes(Math.min(span.end, 1439))}`,
						onPointerDown: (event) => beginDrag(event, span, "move"),
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") onOpen(span.id);
						},
						style: blockStyle(span, bounds.from),
						className: cn("drag-handle absolute z-10 overflow-hidden rounded-lg border px-2 py-1 text-left", span.clash ? "border-danger bg-elevated" : "border-line bg-elevated", span.done && "opacity-50"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: cn("block truncate text-sm", span.done && "line-through"),
								children: span.title
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: cn("block text-xs tabular-nums", span.clash ? "text-danger" : "text-muted"),
								children: [
									fromMinutes(span.start),
									"–",
									fromMinutes(Math.min(span.end, 1439)),
									span.clash ? " · накладка" : "",
									span.assumed ? " · час" : ""
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								"aria-hidden": "true",
								onPointerDown: (event) => beginDrag(event, span, "resize"),
								className: "absolute inset-x-0 bottom-0 flex h-6 items-end px-2 pb-1",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-1 w-full rounded-full bg-line" })
							})
						]
					}, span.id))
				]
			}),
			running.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium text-subtle",
				children: "Проекты в этот день"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-1 flex flex-col",
				children: running.map((project) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => onOpenProjects(project.id),
					className: "h-11 text-left text-sm text-fg",
					children: project.title
				}, project.id))
			})] }) : null,
			ghost ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none fixed z-50 max-w-48 truncate rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-fg",
				style: {
					left: ghost.x + 12,
					top: ghost.y + 12
				},
				children: ghost.title
			}) : null
		]
	});
}
/**
* Current user + loading state. Same behavior in live preview and when deployed:
*   - Auth enabled -> the real signed-in user; `user` is `null` while
*                            the session resolves (`isPending: true`) and when
*                            signed out (`isPending: false`). Session comes from
*                            Better Auth `useSession()` → `/api/auth/get-session`
*                            (cookie when deployed; bearer in live preview).
*   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
*
* Protect a route by waiting out `isPending` before acting on `user` —
* redirecting on `user: null` alone bounces signed-in visitors to sign-in on
* every hard reload:
*
*   import { RedirectToSignIn } from "@/lib/auth/gates";
*   const { user, isPending } = useCurrentUserState();
*   if (isPending) return null;              // still resolving — don't redirect yet
*   if (!user) return <RedirectToSignIn />;  // definitely signed out
*
* `authEnabled` is a module-level constant fixed at load, so the guarded hook
* call keeps a stable hook order across every render of a given component.
*/
function useCurrentUserState() {
	const { data, isPending } = authClient.useSession();
	const user = data?.user;
	return {
		user: user ? {
			id: user.id,
			displayName: user.name ?? null,
			primaryEmail: user.email ?? null,
			profileImageUrl: user.image ?? null,
			isDevFallback: false
		} : null,
		isPending
	};
}
/**
* Convenience view of `useCurrentUserState().user` for display (e.g.
* `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
* for redirects/guards use `useCurrentUserState()` and check `isPending`.
*/
function useCurrentUser() {
	return useCurrentUserState().user;
}
var subscribeToNothing = () => () => {};
var noGateSessionOnServer = () => false;
/**
* Minimal signed-in identity chip + sign-out. Restyle freely (see the
* `design-ui` skill). Sign-out is only shown when auth is enabled (the
* disabled-auth dev user has nothing to sign out of) and the session is not
* gate-materialized — behind the gate the next request signs the viewer
* straight back in, so a sign-out control there is a broken loop.
*/
function UserButton() {
	const user = useCurrentUser();
	const [signingOut, setSigningOut] = (0, import_react.useState)(false);
	const gateSession = (0, import_react.useSyncExternalStore)(subscribeToNothing, hasGateSessionMarker, noGateSessionOnServer);
	if (!user) return null;
	const label = user.displayName ?? user.primaryEmail ?? "Account";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center gap-2",
		children: [
			user.profileImageUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: user.profileImageUrl,
				alt: "",
				className: "h-8 w-8 rounded-full object-cover"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20",
				children: label.charAt(0).toUpperCase()
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-sm font-medium",
				children: label
			}),
			!gateSession && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: signingOut,
				onClick: () => {
					setSigningOut(true);
					signOut().catch(() => setSigningOut(false));
				},
				className: "cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline",
				children: signingOut ? "Signing out…" : "Sign out"
			})
		]
	});
}
var FILE_NAME = "pora.json";
var STAMP_KEY$1 = "pora-sync-stamp";
var DB_NAME = "pora-sync";
var status = {
	supported: false,
	folder: null,
	granted: false
};
var listeners = /* @__PURE__ */ new Set();
function emit(next) {
	status = next;
	listeners.forEach((listener) => listener());
}
function getSyncStatus() {
	return status;
}
function subscribeSync(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
function supported() {
	return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
function openDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore("handles");
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
async function readHandle() {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const request = db.transaction("handles").objectStore("handles").get("dir");
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});
}
async function writeHandle(dir) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const store = db.transaction("handles", "readwrite").objectStore("handles");
		const request = dir ? store.put(dir, "dir") : store.delete("dir");
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}
async function permission(dir, ask) {
	const mode = { mode: "readwrite" };
	const handle = dir;
	if ((handle.queryPermission ? await handle.queryPermission(mode) : "granted") === "granted") return true;
	if (!ask || !handle.requestPermission) return false;
	return await handle.requestPermission(mode) === "granted";
}
function stamp$1() {
	return Number(localStorage.getItem(STAMP_KEY$1) ?? "0") || 0;
}
function setStamp$1(value) {
	localStorage.setItem(STAMP_KEY$1, String(value));
}
function payload(updatedAt) {
	const state = usePlanner.getState();
	return {
		updatedAt,
		lists: state.lists,
		tasks: state.tasks,
		habits: state.habits,
		milestones: state.milestones,
		projects: state.projects,
		workStart: state.workStart,
		workEnd: state.workEnd
	};
}
function fingerprint$1() {
	const body = payload(0);
	return JSON.stringify({
		...body,
		updatedAt: void 0
	});
}
async function readFile(dir) {
	try {
		const file = await (await dir.getFileHandle(FILE_NAME)).getFile();
		const data = JSON.parse(await file.text());
		if (!data || typeof data.updatedAt !== "number") return null;
		return {
			updatedAt: data.updatedAt,
			data
		};
	} catch {
		return null;
	}
}
async function writeFile(dir, updatedAt) {
	const writable = await (await dir.getFileHandle(FILE_NAME, { create: true })).createWritable();
	await writable.write(JSON.stringify(payload(updatedAt)));
	await writable.close();
	setStamp$1(updatedAt);
}
async function refreshSyncStatus() {
	if (!supported()) {
		emit({
			supported: false,
			folder: null,
			granted: false
		});
		return;
	}
	try {
		const dir = await readHandle();
		if (!dir) {
			emit({
				supported: true,
				folder: null,
				granted: false
			});
			return;
		}
		const granted = await permission(dir, false);
		emit({
			supported: true,
			folder: dir.name,
			granted
		});
	} catch {
		emit({
			supported: true,
			folder: null,
			granted: false
		});
	}
}
async function chooseSyncFolder() {
	const pick = window.showDirectoryPicker;
	if (!pick) return;
	const dir = await pick({ mode: "readwrite" });
	await writeHandle(dir);
	emit({
		supported: true,
		folder: dir.name,
		granted: true
	});
	await pushFolderNow();
}
async function allowSyncFolder() {
	const dir = await readHandle();
	if (!dir) return;
	const granted = await permission(dir, true);
	emit({
		supported: true,
		folder: dir.name,
		granted
	});
	if (granted) await pullFolderNow();
}
async function forgetSyncFolder() {
	await writeHandle(null);
	emit({
		supported: supported(),
		folder: null,
		granted: false
	});
}
var applying = false;
async function pullFolderNow() {
	const dir = await readHandle();
	if (!dir || !await permission(dir, false)) return;
	const remote = await readFile(dir);
	if (!remote || remote.updatedAt <= stamp$1()) return;
	applying = true;
	usePlanner.getState().importBackup(remote.data);
	setStamp$1(remote.updatedAt);
	lastBody = fingerprint$1();
	applying = false;
}
async function saveToFiles() {
	const updatedAt = Date.now();
	const body = JSON.stringify(payload(updatedAt));
	const file = [new File([body], FILE_NAME, { type: "application/json" }), new File([body], FILE_NAME, { type: "text/plain" })].find((item) => typeof navigator.canShare === "function" && navigator.canShare({ files: [item] })) ?? null;
	if (file && typeof navigator.share === "function") try {
		await navigator.share({
			files: [file],
			title: "Пора"
		});
		setStamp$1(updatedAt);
		lastBody = fingerprint$1();
		return "saved";
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
	}
	const url = URL.createObjectURL(new File([body], FILE_NAME, { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = FILE_NAME;
	link.click();
	URL.revokeObjectURL(url);
	setStamp$1(updatedAt);
	lastBody = fingerprint$1();
	return "saved";
}
async function openFromFile(file) {
	const data = JSON.parse(await file.text());
	applying = true;
	const ok = usePlanner.getState().importBackup(data);
	if (ok) {
		setStamp$1(typeof data.updatedAt === "number" ? data.updatedAt : Date.now());
		lastBody = fingerprint$1();
	}
	applying = false;
	return ok;
}
async function pushFolderNow() {
	const dir = await readHandle();
	if (!dir || !await permission(dir, false)) return;
	const remote = await readFile(dir);
	if (remote && remote.updatedAt > stamp$1()) {
		await pullFolderNow();
		return;
	}
	await writeFile(dir, Date.now());
	lastBody = fingerprint$1();
}
var lastBody = "";
var timer = 0;
function bindFolderSync() {
	lastBody = fingerprint$1();
	refreshSyncStatus().then(() => pullFolderNow());
	const unsub = usePlanner.subscribe(() => {
		if (applying) return;
		const next = fingerprint$1();
		if (next === lastBody) return;
		lastBody = next;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			pushFolderNow();
		}, 600);
	});
	const onShow = () => {
		if (document.visibilityState === "visible") pullFolderNow();
	};
	document.addEventListener("visibilitychange", onShow);
	const poll = window.setInterval(() => {
		if (document.visibilityState === "visible") pullFolderNow();
	}, 15e3);
	return () => {
		unsub();
		document.removeEventListener("visibilitychange", onShow);
		window.clearTimeout(timer);
		window.clearInterval(poll);
	};
}
function SettingsView() {
	const theme = usePlanner((s) => s.theme);
	const accent = usePlanner((s) => s.accent);
	const setTheme = usePlanner((s) => s.setTheme);
	const setAccent = usePlanner((s) => s.setAccent);
	const { user, isPending } = useCurrentUserState();
	const [sync, setSync] = (0, import_react.useState)(getSyncStatus);
	const [fileNote, setFileNote] = (0, import_react.useState)("");
	const fileRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		refreshSyncStatus();
		return subscribeSync(() => setSync(getSyncStatus()));
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto max-w-md",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display text-lg tracking-tight",
				children: "Оформление"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3 grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": theme === "light",
					onClick: () => setTheme("light"),
					className: cn("h-11 rounded-xl text-sm", theme === "light" ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-fg"),
					children: "Светлая"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": theme === "dark",
					onClick: () => setTheme("dark"),
					className: cn("h-11 rounded-xl text-sm", theme === "dark" ? "bg-accent text-accent-fg" : "card-lift bg-elevated text-fg"),
					children: "Тёмная"
				})]
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-lg tracking-tight",
						children: "Цвет"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "Кнопки, выбранный день и отметки."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4 grid grid-cols-4 gap-3",
						children: ACCENTS.map((item) => {
							const on = accent === item.id;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								"aria-pressed": on,
								"aria-label": item.name,
								onClick: () => setAccent(item.id),
								className: "flex flex-col items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("size-11 rounded-full", item.swatch, on ? "ring-2 ring-fg ring-offset-2 ring-offset-bg" : "") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: cn("text-xs", on ? "text-fg" : "text-muted"),
									children: item.name
								})]
							}, item.id);
						})
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-lg tracking-tight",
					children: "Автосинхронизация"
				}), isPending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "Проверяем вход…"
				}) : user ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "Включена. Пока приложение открыто, задачи сами ходят между этим телефоном и другими устройствами с тем же входом."
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButton, {})
				})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "Войдите на телефоне, где задачи уже есть. Потом тем же способом на компьютере. Дальше синхронизация идёт сама."
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3 flex flex-col gap-2",
					children: GROK_PROVIDERS.map((provider) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => void signIn(provider.providerId, { callbackURL: "/" }),
						className: "h-11 rounded-xl bg-accent text-sm text-accent-fg",
						children: ["Войти через ", provider.label]
					}, provider.providerId))
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-lg tracking-tight",
					children: "Файл"
				}), sync.supported ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: sync.folder ? `Папка «${sync.folder}». Изменения пишутся в pora.json.` : "Выберите папку, которую уже синхронизирует облако: Synology Drive, iCloud или Dropbox."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [sync.folder && !sync.granted ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => void allowSyncFolder(),
							className: "h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg",
							children: "Разрешить папку"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => void chooseSyncFolder().catch(() => void 0),
							className: "h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg",
							children: sync.folder ? "Другая папка" : "Выбрать папку"
						}), sync.folder ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => void forgetSyncFolder(),
							className: "h-11 rounded-xl px-4 text-sm text-muted",
							children: "Отключить"
						}) : null]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-xs text-subtle",
						children: "Если править сразу на двух устройствах, останется более позднее сохранение."
					})
				] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "На iPhone нажмите «Сохранить в Файлы» и выберите папку в iCloud или «На iPhone». Тот же файл потом открывается обратно."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								saveToFiles().then((result) => {
									setFileNote(result === "saved" ? "Сохранено." : "Сохранение отменено.");
								});
							},
							className: "h-11 rounded-xl bg-accent px-4 text-sm text-accent-fg",
							children: "Сохранить в Файлы"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => fileRef.current?.click(),
							className: "h-11 rounded-xl px-4 text-sm text-fg",
							children: "Открыть из Файлов"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						ref: fileRef,
						type: "file",
						accept: ".json,application/json,text/plain",
						className: "hidden",
						onChange: (event) => {
							const file = event.target.files?.[0];
							event.target.value = "";
							if (!file) return;
							openFromFile(file).then((ok) => setFileNote(ok ? "Файл открыт." : "В файле нет задач."), () => setFileNote("Файл не подошёл."));
						}
					}),
					fileNote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-xs text-muted",
						children: fileNote
					}) : null
				] })]
			})
		]
	});
}
var SMART = [
	{
		id: "inbox",
		label: "Входящие",
		icon: Inbox
	},
	{
		id: "today",
		label: "Сегодня",
		icon: CalendarCheck
	},
	{
		id: "tomorrow",
		label: "Завтра",
		icon: Sunrise
	},
	{
		id: "week",
		label: "7 дней",
		icon: CalendarRange
	},
	{
		id: "checklist",
		label: "Все",
		icon: ListChecks
	},
	{
		id: "calendar",
		label: "Календарь",
		icon: CalendarDays
	}
];
var TOOLS = [
	{
		id: "schedule",
		label: "Расписание",
		icon: Clock
	},
	{
		id: "projects",
		label: "Проекты",
		icon: Columns3
	},
	{
		id: "matrix",
		label: "Матрица",
		icon: LayoutGrid
	},
	{
		id: "focus",
		label: "Фокус",
		icon: Timer
	},
	{
		id: "habits",
		label: "Привычки",
		icon: Repeat
	},
	{
		id: "dates",
		label: "Даты",
		icon: Hourglass
	},
	{
		id: "assist",
		label: "Помощник",
		icon: MessageSquare
	}
];
function Sidebar({ view, onView, onClose }) {
	const lists = usePlanner((s) => s.lists);
	const tasks = usePlanner((s) => s.tasks);
	const habits = usePlanner((s) => s.habits);
	const addList = usePlanner((s) => s.addList);
	const today = todayIso();
	const [draft, setDraft] = (0, import_react.useState)("");
	const [adding, setAdding] = (0, import_react.useState)(false);
	const habitLeft = habits.filter((h) => !h.checks.includes(today)).length;
	function count(id) {
		if (id === "today") return countToday(tasks, today);
		if (id === "tomorrow") return countTomorrow(tasks, today);
		if (id === "week") return countWeek(tasks, today);
		if (id === "checklist") return countOpen(tasks);
		if (id === "inbox") return countInbox(tasks);
		if (id === "habits") return habitLeft;
		return null;
	}
	function itemActive(id) {
		return view === id;
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex h-full min-h-0 flex-col bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2 px-3 py-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", {
							viewBox: "0 0 32 32",
							className: "size-4",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", {
								d: "M7 16.5 13 22.5 25 9.5",
								fill: "none",
								stroke: "currentColor",
								strokeWidth: "2.6",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "min-w-0 flex-1 font-display text-xl leading-none tracking-tight",
						children: "Пора"
					}),
					onClose ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "icon",
						variant: "ghost",
						"aria-label": "Закрыть меню",
						onClick: onClose,
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-5" })
					}) : null
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
				className: "min-h-0 flex-1 overflow-y-auto px-2 pb-2",
				"aria-label": "Разделы",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "px-2 pb-1 text-xs font-medium text-subtle",
						children: "Смарт-списки"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "flex flex-col",
						children: SMART.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavRow, {
							item,
							active: itemActive(item.id),
							count: count(item.id),
							alert: item.id === "today" && tasks.some((t) => !t.done && t.due != null && t.due < today),
							onView
						}, item.id))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 px-2 pb-1 text-xs font-medium text-subtle",
						children: "Инструменты"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "grid grid-cols-2 gap-1",
						children: TOOLS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavRow, {
							item,
							active: itemActive(item.id),
							count: count(item.id),
							alert: false,
							onView
						}, item.id))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex items-center justify-between px-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium text-subtle",
							children: "Списки"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": "Новый список",
							onClick: () => setAdding(true),
							className: "flex size-8 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-fg",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "size-4" })
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "flex flex-col",
						children: lists.map((list) => {
							const id = `list:${list.id}`;
							const active = view === id;
							const n = countList(tasks, list.id);
							return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								"aria-current": active ? "page" : void 0,
								onClick: () => onView(id),
								className: cn("flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150", active ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg"),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "size-1.5 shrink-0 rounded-full bg-accent",
										"aria-hidden": "true"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "min-w-0 flex-1 truncate",
										children: list.name
									}),
									n > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "tabular-nums text-xs text-subtle",
										children: n
									}) : null
								]
							}) }, list.id);
						})
					}),
					(() => {
						const tags = [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort((a, b) => a.localeCompare(b, "ru"));
						if (tags.length === 0) return null;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "px-2 pb-1 text-xs font-medium text-subtle",
								children: "Теги"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "flex flex-wrap gap-1 px-1",
								children: tags.map((tag) => {
									const id = `tag:${tag}`;
									const n = tasks.filter((task) => !task.done && (task.tags ?? []).includes(tag)).length;
									return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										"aria-current": view === id ? "page" : void 0,
										onClick: () => onView(id),
										className: cn("flex h-10 items-center gap-1 rounded-full border px-3 text-sm", view === id ? "border-accent bg-elevated font-medium text-fg" : "border-line text-muted"),
										children: [
											"#",
											tag,
											n > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												className: "tabular-nums text-xs text-subtle",
												children: n
											}) : null
										]
									}, tag);
								})
							})]
						});
					})(),
					adding ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("form", {
						className: "mt-1 px-2",
						onSubmit: (event) => {
							event.preventDefault();
							const name = draft.trim();
							if (!name) {
								setAdding(false);
								return;
							}
							const id = addList(name);
							setDraft("");
							setAdding(false);
							onView(`list:${id}`);
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							autoFocus: true,
							value: draft,
							onChange: (event) => setDraft(event.target.value),
							onBlur: () => {
								if (!draft.trim()) setAdding(false);
							},
							placeholder: "Название списка",
							"aria-label": "Название списка",
							className: "h-11 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg outline-none placeholder:text-subtle"
						})
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						"aria-current": view === "done" ? "page" : void 0,
						onClick: () => onView("done"),
						className: cn("mt-1 flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150", view === "done" ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CheckCheck, {
							className: "size-4 shrink-0",
							strokeWidth: 1.75
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "min-w-0 flex-1 truncate",
							children: "Готово"
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "shrink-0 border-t border-line px-2 py-2",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-current": view === "settings" ? "page" : void 0,
					onClick: () => onView("settings"),
					className: cn("flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm", view === "settings" ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg"),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Settings, {
						className: "size-4 shrink-0",
						strokeWidth: 1.75
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "min-w-0 flex-1 truncate",
						children: "Настройки"
					})]
				})
			})
		]
	});
}
function NavRow({ item, active, count, alert, onView }) {
	const Icon = item.icon;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		"aria-current": active ? "page" : void 0,
		onClick: () => onView(item.id),
		className: cn("flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-150", active ? "bg-elevated font-medium text-fg" : "text-muted hover:bg-elevated hover:text-fg"),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
				className: "size-4 shrink-0",
				strokeWidth: 1.75
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "min-w-0 flex-1 truncate",
				children: item.label
			}),
			count != null && count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: cn("tabular-nums text-xs", alert ? "text-danger" : "text-subtle"),
				children: count
			}) : null
		]
	}) });
}
function TodaySummary() {
	const tasks = usePlanner((s) => s.tasks);
	const habits = usePlanner((s) => s.habits);
	const milestones = usePlanner((s) => s.milestones);
	const today = todayIso();
	const soon = (milestones ?? []).map((item) => {
		const when = nextOccurrence(item.date, item.yearly, today);
		return {
			item,
			days: daysBetween(today, when)
		};
	}).filter((row) => row.days >= 0 && row.days <= 14).sort((a, b) => a.days - b.days);
	const todayN = tasks.filter((task) => !task.done && task.due === today).length;
	const overdueN = tasks.filter((task) => !task.done && task.due != null && task.due < today).length;
	const habitLeft = habits.filter((habit) => !habit.checks.includes(today)).length;
	const nextDate = soon[0];
	const line = [
		todayN === 0 && overdueN === 0 ? "На сегодня задач нет" : `${todayN} на сегодня`,
		overdueN > 0 ? `${overdueN} просрочено` : "",
		habits.length === 0 ? "" : habitLeft === 0 ? "привычки отмечены" : `привычки ${habitLeft}`
	].filter(Boolean).join(" · ");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mb-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-display text-xl tracking-tight text-fg",
			children: line
		}), nextDate ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "text-xs text-muted",
			children: [
				nextDate.item.title,
				" — ",
				countdownLabel(nextDate.days)
			]
		}) : null]
	});
}
function WeekDays({ selected, onPick }) {
	const tasks = usePlanner((s) => s.tasks);
	const habits = usePlanner((s) => s.habits);
	const today = todayIso();
	const days = Array.from({ length: 7 }, (_, index) => shiftIso(today, index));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "grid grid-cols-7 gap-1",
		children: days.map((day) => {
			const count = tasks.filter((task) => !task.done && task.due === day).length;
			const habitsDone = habits.length > 0 && habits.every((habit) => habit.checks.includes(day));
			const on = day === selected;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				"aria-pressed": on,
				"aria-label": `${weekdayLetter(day)} ${Number(day.slice(8))}, задач ${count}`,
				onClick: () => onPick(day),
				className: cn("flex min-h-14 flex-col items-center justify-center rounded-xl px-1 py-1.5 text-xs", on ? "bg-accent text-accent-fg" : "text-muted"),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: weekdayLetter(day) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "tabular-nums",
						children: Number(day.slice(8))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "mt-1 tabular-nums",
						children: count > 0 ? count : "·"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("mt-0.5 size-1.5 rounded-full", habitsDone ? "bg-current" : "bg-transparent") })
				]
			}, day);
		})
	});
}
function TodayStrip({ onPick }) {
	const habits = usePlanner((s) => s.habits);
	const toggleHabit = usePlanner((s) => s.toggleHabit);
	const today = todayIso();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-8 space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(WeekDays, {
			selected: today,
			onPick
		}), habits.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-xs font-medium text-subtle",
			children: "Привычки сегодня"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-2 flex flex-wrap gap-2",
			children: habits.map((habit) => {
				const on = habit.checks.includes(today);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": on,
					onClick: () => toggleHabit(habit.id, today),
					className: cn("h-11 rounded-full border px-3 text-sm", on ? "border-accent bg-accent text-accent-fg" : "border-line bg-elevated text-fg"),
					children: habit.name
				}, habit.id);
			})
		})] }) : null]
	});
}
function defaultsFor(view, today) {
	if (view.startsWith("list:")) return {
		listId: view.slice(5),
		due: null
	};
	if (view === "tomorrow") return {
		listId: null,
		due: shiftIso(today, 1)
	};
	if (view.startsWith("day:")) return {
		listId: null,
		due: view.slice(4)
	};
	if (view === "today" || view === "week") return {
		listId: null,
		due: today
	};
	return {
		listId: null,
		due: null
	};
}
function canBoard(view) {
	return view === "inbox" || view === "tomorrow" || view === "week" || view.startsWith("list:") || view.startsWith("tag:");
}
function Empty({ title, hint }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "px-2 py-16 text-center",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "font-display text-2xl tracking-tight",
			children: title
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-sm text-muted",
			children: hint
		})]
	});
}
function TaskViews({ view, query, selectedId, onOpen, onPickDay }) {
	const tasks = usePlanner((s) => s.tasks);
	const lists = usePlanner((s) => s.lists);
	const addTask = usePlanner((s) => s.addTask);
	const updateTask = usePlanner((s) => s.updateTask);
	const today = todayIso();
	const [showDone, setShowDone] = (0, import_react.useState)(false);
	const [mode, setMode] = (0, import_react.useState)("list");
	const searching = query.trim().length > 0;
	const board = canBoard(view) && mode === "board" && !searching;
	const found = searching ? tasks.filter((task) => matchesQuery(task, query, lists)).sort(byNewest) : [];
	const open = scopeTasks(tasks, view, today).sort(byNewest);
	const done = doneInScope(tasks, view, today);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		!searching && view !== "done" && view !== "calendar" && view !== "focus" && view !== "habits" && view !== "today" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddTaskForm, {
			placeholder: "Созвон завтра в 10",
			onAdd: (title) => addTask({
				title,
				...defaultsFor(view, today),
				tags: view.startsWith("tag:") ? [view.slice(4)] : void 0
			})
		}) : null,
		canBoard(view) && !searching ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-3 grid grid-cols-2 gap-1 rounded-md border border-line p-1",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-pressed": mode === "list",
				onClick: () => setMode("list"),
				className: cn("h-11 rounded-md text-sm", mode === "list" ? "bg-elevated font-medium text-fg" : "text-muted"),
				children: "Список"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-pressed": mode === "board",
				onClick: () => setMode("board"),
				className: cn("h-11 rounded-md text-sm", mode === "board" ? "bg-elevated font-medium text-fg" : "text-muted"),
				children: "Доска"
			})]
		}) : null,
		searching ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4",
			children: found.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
				title: "Ничего не нашлось",
				hint: "Попробуйте другое слово, тег или название списка."
			}) : found.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
				task,
				today,
				selected: selectedId === task.id,
				showDue: true,
				showList: true,
				onOpen
			}, task.id))
		}) : view === "week" && !board ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WeekGroups, {
			tasks: open,
			today,
			selectedId,
			onOpen
		}) : view === "today" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TodaySummary, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddTaskForm, {
				placeholder: "Созвон завтра в 10",
				onAdd: (title) => addTask({
					title,
					...defaultsFor(view, today)
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TodayGroups, {
				tasks: open,
				today,
				selectedId,
				onOpen
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TodayStrip, { onPick: onPickDay })
		] }) : view.startsWith("day:") ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(WeekDays, {
				selected: view.slice(4),
				onPick: onPickDay
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-3",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddTaskForm, {
					placeholder: "Задача на этот день",
					onAdd: (title) => addTask({
						title,
						due: view.slice(4),
						listId: null
					})
				})
			}),
			open.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
				title: "На этот день пусто",
				hint: "Добавьте задачу или перенесите сюда с другого дня."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-3",
				children: open.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
					task,
					today,
					selected: selectedId === task.id,
					showDue: false,
					showList: true,
					onOpen
				}, task.id))
			})
		] }) : board ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PriorityBoard, {
			tasks: open,
			today,
			selectedId,
			onOpen,
			onPriority: (id, priority) => updateTask(id, {
				priority,
				important: priority >= 2
			})
		}) : open.length === 0 && view !== "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
			title: view === "inbox" ? "Входящие пусты" : view === "tomorrow" ? "На завтра пусто" : view.startsWith("tag:") ? "С этим тегом пусто" : "Список пуст",
			hint: "Добавьте задачу — она останется на этом устройстве."
		}) : view === "done" ? doneAll(tasks, selectedId, today, onOpen) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-3",
			children: open.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
				task,
				today,
				selected: selectedId === task.id,
				showDue: true,
				showList: view.startsWith("tag:"),
				onOpen
			}, task.id))
		}),
		!searching && done.length > 0 && view !== "done" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-6",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				variant: "ghost",
				className: "text-muted",
				onClick: () => setShowDone((value) => !value),
				children: ["Выполнено · ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "tabular-nums",
					children: done.length
				})]
			}), showDone ? done.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
				task,
				today,
				selected: selectedId === task.id,
				showDue: view !== "today",
				showList: view === "today" || view === "inbox",
				onOpen
			}, task.id)) : null]
		}) : null
	] });
}
function doneAll(tasks, selectedId, today, onOpen) {
	const items = tasks.filter((task) => task.done).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
	if (items.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
		title: "Пока пусто",
		hint: "Выполненные задачи появятся здесь."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: items.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
		task,
		today,
		selected: selectedId === task.id,
		showDue: true,
		showList: true,
		onOpen
	}, task.id)) });
}
function TodayGroups({ tasks, today, selectedId, onOpen }) {
	const overdue = tasks.filter((task) => task.due != null && task.due < today);
	const current = tasks.filter((task) => task.due === today);
	if (overdue.length === 0 && current.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
		title: "День свободен",
		hint: "Добавьте задачу на сегодня — или оставьте паузу."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [overdue.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "mt-5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "px-1 font-display text-lg tracking-tight text-danger",
			children: "Просрочено"
		}), overdue.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
			task,
			today,
			selected: selectedId === task.id,
			showDue: true,
			showList: true,
			onOpen
		}, task.id))]
	}) : null, current.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "mt-5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "px-1 font-display text-lg tracking-tight text-fg",
			children: "На сегодня"
		}), [...current].sort((a, b) => (a.startAt ?? a.remindAt ?? "99:99").localeCompare(b.startAt ?? b.remindAt ?? "99:99")).map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
			task,
			today,
			selected: selectedId === task.id,
			showDue: false,
			showList: true,
			onOpen
		}, task.id))]
	}) : null] });
}
function WeekGroups({ tasks, today, selectedId, onOpen }) {
	const groups = Array.from({ length: 7 }, (_, index) => shiftIso(today, index)).map((day) => ({
		day,
		items: tasks.filter((task) => task.due === day)
	})).filter((group) => group.items.length > 0);
	if (groups.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
		title: "Неделя свободна",
		hint: "Задачи с датой на ближайшие 7 дней появятся здесь."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "mt-5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "px-3 text-sm font-medium text-muted",
			children: formatLong(group.day)
		}), group.items.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskRow, {
			task,
			today,
			selected: selectedId === task.id,
			showDue: false,
			showList: true,
			onOpen
		}, task.id))]
	}, group.day)) });
}
var COLUMNS = [
	{
		priority: 3,
		title: "Высокий"
	},
	{
		priority: 2,
		title: "Средний"
	},
	{
		priority: 1,
		title: "Низкий"
	},
	{
		priority: 0,
		title: "Без приоритета"
	}
];
function PriorityBoard({ tasks, today, selectedId, onOpen, onPriority }) {
	const [over, setOver] = (0, import_react.useState)(null);
	const [ghost, setGhost] = (0, import_react.useState)(null);
	const scrollerRef = (0, import_react.useRef)(null);
	function begin(event, task) {
		if (event.button !== 0) return;
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const startY = event.clientY;
		let moved = false;
		let target = task.priority;
		const move = (ev) => {
			if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) moved = true;
			if (!moved) return;
			const node = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-priority]");
			const next = Number(node?.dataset.priority);
			if (next === 0 || next === 1 || next === 2 || next === 3) target = next;
			setOver(target);
			setGhost({
				title: task.title,
				x: ev.clientX,
				y: ev.clientY
			});
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const rect = scroller.getBoundingClientRect();
			if (ev.clientX < rect.left + 36) scroller.scrollLeft -= 18;
			else if (ev.clientX > rect.right - 36) scroller.scrollLeft += 18;
		};
		const finish = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", finish);
			handle.removeEventListener("pointercancel", finish);
			if (moved && target !== task.priority) onPriority(task.id, target);
			else if (!moved) onOpen(task.id);
			setOver(null);
			setGhost(null);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", finish);
		handle.addEventListener("pointercancel", finish);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted",
				children: "Потяните карточку в другой приоритет."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				ref: scrollerRef,
				className: "mt-2 flex gap-2 overflow-x-auto pb-2",
				children: COLUMNS.map((column) => {
					const items = tasks.filter((task) => task.priority === column.priority);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						"data-priority": column.priority,
						className: cn("flex w-64 shrink-0 flex-col rounded-lg border bg-bg p-3", over === column.priority ? "border-accent" : "border-line"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "flex h-11 items-center justify-between text-sm font-medium",
							children: [column.title, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "tabular-nums text-xs text-subtle",
								children: items.length
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "flex min-h-16 flex-col gap-2",
							children: items.map((task) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: cn("drag-handle rounded-md border border-line bg-elevated px-3 py-3", selectedId === task.id && "border-accent"),
								onPointerDown: (event) => begin(event, task),
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "flex items-start gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(GripVertical, { className: "mt-0.5 size-4 shrink-0 text-subtle" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "min-w-0 flex-1",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "block text-sm text-fg",
											children: task.title
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "mt-1 block text-xs text-muted",
											children: task.due ? dueLabel(task.due, today) : "без даты"
										})]
									})]
								})
							}) }, task.id))
						})]
					}, column.priority);
				})
			}),
			ghost ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "pointer-events-none fixed z-50 max-w-48 truncate rounded-md border border-line bg-elevated px-3 py-2 text-sm",
				style: {
					left: ghost.x + 12,
					top: ghost.y + 12
				},
				children: ghost.title
			}) : null
		]
	});
}
function snapshot$1(data) {
	if (!data || typeof data.updatedAt !== "number" || !Array.isArray(data.tasks) || !Array.isArray(data.lists)) throw new Error("bad snapshot");
	return data;
}
var pullSnapshot = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("17dce6e2fbe4414952a05e6db96a9e8c0b06d9e39790569ab83b837ce5ae7a83"));
var pushSnapshot = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator(snapshot$1).handler(createSsrRpc("60742a04073702a645436e9518bdc1f374e7536bcbf8c54c564b6fdfd7726c0f"));
var STAMP_KEY = "pora-account-stamp";
function stamp() {
	return Number(localStorage.getItem(STAMP_KEY) ?? "0") || 0;
}
function setStamp(value) {
	localStorage.setItem(STAMP_KEY, String(value));
}
function snapshot(updatedAt) {
	const state = usePlanner.getState();
	return {
		updatedAt,
		lists: state.lists,
		tasks: state.tasks,
		habits: state.habits,
		milestones: state.milestones,
		projects: state.projects,
		workStart: state.workStart,
		workEnd: state.workEnd
	};
}
function fingerprint() {
	const body = snapshot(0);
	return JSON.stringify(body);
}
function bindAccountSync() {
	let applying = false;
	let lastBody = fingerprint();
	let timer = 0;
	async function pushNow() {
		const result = await pushSnapshot({ data: snapshot(Date.now()) });
		if (!result.ok) {
			await pullNow();
			return;
		}
		setStamp(result.updatedAt);
		lastBody = fingerprint();
	}
	async function pullNow() {
		const remote = await pullSnapshot();
		const local = stamp();
		if (!remote) {
			await pushNow();
			return;
		}
		if (remote.updatedAt <= local) return;
		applying = true;
		usePlanner.getState().importBackup(remote.payload);
		setStamp(remote.updatedAt);
		lastBody = fingerprint();
		applying = false;
	}
	pullNow().catch(() => void 0);
	const unsub = usePlanner.subscribe(() => {
		if (applying) return;
		const next = fingerprint();
		if (next === lastBody) return;
		lastBody = next;
		window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			pushNow().catch(() => void 0);
		}, 700);
	});
	const onShow = () => {
		if (document.visibilityState === "visible") pullNow().catch(() => void 0);
	};
	document.addEventListener("visibilitychange", onShow);
	const poll = window.setInterval(() => {
		if (document.visibilityState === "visible") pullNow().catch(() => void 0);
	}, 15e3);
	return () => {
		unsub();
		document.removeEventListener("visibilitychange", onShow);
		window.clearTimeout(timer);
		window.clearInterval(poll);
	};
}
function useAccountSync(ready) {
	const { user, isPending } = useCurrentUserState();
	(0, import_react.useEffect)(() => {
		if (!ready || isPending || !user) return;
		return bindAccountSync();
	}, [
		ready,
		isPending,
		user
	]);
}
var MOBILE = [
	{
		id: "today",
		label: "Сегодня",
		icon: CalendarCheck
	},
	{
		id: "calendar",
		label: "Календарь",
		icon: CalendarDays
	},
	{
		id: "schedule",
		label: "Расписание",
		icon: Clock
	},
	{
		id: "habits",
		label: "Привычки",
		icon: Repeat
	},
	{
		id: "focus",
		label: "Фокус",
		icon: Timer
	}
];
function viewTitle(view, lists) {
	if (view === "today") return "Сегодня";
	if (view === "tomorrow") return "Завтра";
	if (view === "week") return "7 дней";
	if (view === "inbox") return "Входящие";
	if (view === "checklist") return "Все";
	if (view === "matrix") return "Матрица";
	if (view === "done") return "Готово";
	if (view === "calendar") return "Календарь";
	if (view === "focus") return "Фокус";
	if (view === "habits") return "Привычки";
	if (view === "dates") return "Даты";
	if (view === "assist") return "Помощник";
	if (view === "schedule") return "Расписание";
	if (view === "projects") return "Проекты";
	if (view === "settings") return "Настройки";
	if (view.startsWith("tag:")) return `#${view.slice(4)}`;
	if (view.startsWith("day:")) return formatLong(view.slice(4));
	return lists.find((list) => list.id === view.slice(5))?.name ?? "Список";
}
function PlannerApp() {
	const lists = usePlanner((s) => s.lists);
	const tasks = usePlanner((s) => s.tasks);
	const theme = usePlanner((s) => s.theme);
	const accent = usePlanner((s) => s.accent);
	const focus = usePlanner((s) => s.focus);
	const tickFocus = usePlanner((s) => s.tickFocus);
	const startFocus = usePlanner((s) => s.startFocus);
	const pauseFocus = usePlanner((s) => s.pauseFocus);
	const renameList = usePlanner((s) => s.renameList);
	const deleteList = usePlanner((s) => s.deleteList);
	const ackReminder = usePlanner((s) => s.ackReminder);
	const hits = useReminderHits();
	const dueHits = hits.filter((hit) => hit.status === "due");
	useReminderChime(dueHits);
	const [view, setView] = (0, import_react.useState)("today");
	const [projectId, setProjectId] = (0, import_react.useState)(null);
	const [selectedId, setSelectedId] = (0, import_react.useState)(null);
	const [query, setQuery] = (0, import_react.useState)("");
	const [searchOpen, setSearchOpen] = (0, import_react.useState)(false);
	const [drawer, setDrawer] = (0, import_react.useState)(false);
	const [bell, setBell] = (0, import_react.useState)(false);
	const [confirmList, setConfirmList] = (0, import_react.useState)(false);
	const [hydrated, setHydrated] = (0, import_react.useState)(false);
	const today = todayIso();
	const task = tasks.find((item) => item.id === selectedId) ?? null;
	const listId = view.startsWith("list:") ? view.slice(5) : null;
	(0, import_react.useEffect)(() => {
		let stop = () => {};
		Promise.resolve(usePlanner.persist.rehydrate()).then(() => {
			setHydrated(true);
			stop = bindFolderSync();
		});
		return () => stop();
	}, []);
	useAccountSync(hydrated);
	(0, import_react.useEffect)(() => {
		if (!focus.running || !tickFocus) return;
		const id = window.setInterval(() => {
			if (tickFocus()) beep();
		}, 250);
		return () => window.clearInterval(id);
	}, [focus.running, tickFocus]);
	(0, import_react.useEffect)(() => {
		document.documentElement.dataset.theme = theme;
		document.documentElement.dataset.accent = accent;
	}, [theme, accent]);
	(0, import_react.useEffect)(() => {
		let last = 0;
		const apply = () => {
			const next = Math.round(window.visualViewport?.height ?? window.innerHeight);
			if (Math.abs(next - last) < 2) return;
			last = next;
			document.documentElement.style.setProperty("--app-h", `${next}px`);
		};
		apply();
		window.visualViewport?.addEventListener("resize", apply);
		window.addEventListener("orientationchange", apply);
		return () => {
			window.visualViewport?.removeEventListener("resize", apply);
			window.removeEventListener("orientationchange", apply);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			if (event.key !== "Escape") return;
			setSelectedId(null);
			setDrawer(false);
			setBell(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	(0, import_react.useEffect)(() => {
		if (listId && !lists.some((list) => list.id === listId)) setView("inbox");
	}, [listId, lists]);
	(0, import_react.useEffect)(() => {
		if (selectedId && !tasks.some((item) => item.id === selectedId)) setSelectedId(null);
	}, [selectedId, tasks]);
	function openView(next) {
		setView(next);
		if (next !== "projects") setProjectId(null);
		setDrawer(false);
		setBell(false);
		setQuery("");
		setSearchOpen(false);
		setConfirmList(false);
	}
	function openHit(hit) {
		setBell(false);
		if (hit.kind === "task") {
			setSelectedId(hit.refId);
			return;
		}
		setSelectedId(null);
		openView(hit.kind === "habit" ? "habits" : "dates");
	}
	const subtitle = (() => {
		if (query.trim()) return "Поиск по названию, заметке и тегам";
		if (view === "today") return "";
		if (view === "week") return `${formatLong(today)} — ${formatLong(shiftIso(today, 6))}`;
		if (view === "tomorrow") return formatLong(shiftIso(today, 1));
		if (view === "inbox") return "Без списка";
		if (view === "done") return "Всё, что уже закрыто";
		if (view === "calendar") return "Перетащите задачу или этап на другой день";
		if (view === "focus") return "Таймер остаётся на экране, пока идёт сессия";
		if (view === "habits") return "Отметки за неделю";
		if (view === "checklist") return "Все открытые задачи";
		if (view === "matrix") return "Важно и срочно — по разные стороны";
		if (view === "dates") return "Дни до дня рождения, годовщины и праздника";
		if (view === "assist") return "Разложить мысли на задачи";
		if (view === "schedule") return "Рабочие часы, свободные окна и накладки";
		if (view === "projects") return "Длинные дела по этапам";
		if (view === "settings") return "Оформление и цвет";
		if (view.startsWith("tag:")) {
			const n = scopeTasks(tasks, view, today).length;
			return n === 0 ? "Нет открытых задач с этим тегом" : `${n} открытых`;
		}
		if (view.startsWith("day:")) {
			const n = scopeTasks(tasks, view, today).length;
			return n === 0 ? "На этот день задач нет" : `${n} открытых`;
		}
		const n = scopeTasks(tasks, view, today).length;
		return n === 0 ? "Пока нет открытых задач" : `${n} открытых`;
	})();
	const showLists = view === "today" || view === "tomorrow" || view === "week" || view === "inbox" || view === "done" || view.startsWith("list:") || view.startsWith("tag:") || view.startsWith("day:") || query.trim().length > 0;
	const showSearch = searchOpen || query.trim().length > 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "app-frame relative flex overflow-hidden bg-surface text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
				className: "hidden h-full w-64 shrink-0 border-r border-line md:flex",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sidebar, {
					view,
					onView: openView
				})
			}),
			drawer ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sheet absolute inset-x-0 bottom-0 z-40 md:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "scrim absolute inset-0",
					"aria-label": "Закрыть меню",
					onClick: () => setDrawer(false)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "sheet-safe absolute inset-y-0 left-0 flex w-72 flex-col bg-bg",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sidebar, {
						view,
						onView: openView,
						onClose: () => setDrawer(false)
					})
				})]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex min-w-0 flex-1 flex-col",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "relative z-20 shrink-0 px-4 py-3 md:px-8",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center gap-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										size: "icon",
										variant: "ghost",
										className: "md:hidden",
										"aria-label": "Открыть меню",
										onClick: () => setDrawer(true),
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, { className: "size-5" })
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "min-w-0 flex-1",
										children: [listId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											"aria-label": "Название списка",
											value: lists.find((list) => list.id === listId)?.name ?? "",
											onChange: (event) => renameList(listId, event.target.value),
											onBlur: () => {
												if (!(lists.find((list) => list.id === listId)?.name ?? "").trim()) renameList(listId, "Без названия");
											},
											className: "w-full bg-transparent font-display text-2xl tracking-tight outline-none md:text-4xl"
										}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
											className: "truncate font-display text-2xl tracking-tight md:text-4xl",
											children: viewTitle(view, lists)
										}), subtitle ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
											className: "truncate text-xs text-muted",
											children: subtitle
										}) : null]
									}),
									listId ? confirmList ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										variant: "destructive",
										size: "sm",
										onClick: () => {
											deleteList(listId);
											setView("inbox");
											setConfirmList(false);
										},
										children: "Удалить"
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										variant: "ghost",
										className: "text-muted",
										onClick: () => setConfirmList(true),
										children: "Удалить"
									}) : null,
									showSearch ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
										size: "icon",
										variant: "ghost",
										"aria-label": "Поиск",
										onClick: () => setSearchOpen(true),
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "size-5" })
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReminderBell, {
										dueCount: dueHits.length,
										open: bell,
										onToggle: () => setBell((open) => !open)
									})
								]
							}),
							showSearch ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "relative mt-3 block",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: query,
										onChange: (event) => setQuery(event.target.value),
										placeholder: "Поиск",
										"aria-label": "Поиск задач",
										autoFocus: true,
										className: "card-lift h-11 w-full rounded-2xl bg-elevated pr-11 pl-10 text-base outline-none placeholder:text-subtle",
										suppressHydrationWarning: true
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "Закрыть поиск",
										onClick: () => {
											setQuery("");
											setSearchOpen(false);
										},
										className: "absolute top-0 right-0 flex size-11 items-center justify-center text-subtle",
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
									})
								]
							}) : null,
							bell ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": "Закрыть напоминания",
								className: "fixed inset-0 z-20 cursor-default",
								onClick: () => setBell(false)
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReminderPanel, {
								hits,
								onOpen: openHit,
								onAck: (hit) => ackReminder(hit.key, hit.stamp)
							})] }) : null
						]
					}),
					dueHits.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReminderBanner, {
						due: dueHits,
						onOpen: openHit,
						onAck: (hit) => ackReminder(hit.key, hit.stamp),
						onMore: () => setBell(true)
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 md:px-8 md:py-6",
						children: [
							showLists ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskViews, {
								view,
								query,
								selectedId,
								onOpen: setSelectedId,
								onPickDay: (day) => openView(day === today ? "today" : `day:${day}`)
							}, view) : null,
							!query.trim() && view === "calendar" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarView, {
								selectedId,
								onOpen: setSelectedId
							}) : null,
							!query.trim() && view === "checklist" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChecklistView, {
								selectedId,
								onOpen: setSelectedId
							}) : null,
							!query.trim() && view === "matrix" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MatrixView, {
								selectedId,
								onOpen: setSelectedId
							}) : null,
							!query.trim() && view === "focus" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FocusView, {}) : null,
							!query.trim() && view === "habits" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HabitsView, {}) : null,
							!query.trim() && view === "dates" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DatesView, {}) : null,
							!query.trim() && view === "assist" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AssistView, { onOpen: setSelectedId }) : null,
							!query.trim() && view === "schedule" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScheduleView, {
								onOpen: setSelectedId,
								onOpenProjects: (id) => {
									setProjectId(id);
									openView("projects");
								}
							}) : null,
							!query.trim() && view === "projects" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectsView, { initialId: projectId }, projectId ?? "all") : null,
							!query.trim() && view === "settings" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsView, {}) : null
						]
					}),
					focus.running || focus.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex h-14 shrink-0 items-center gap-3 border-t border-line px-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display text-xl tabular-nums",
								children: formatFocusClock(focus.seconds)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "min-w-0 flex-1 truncate text-sm text-muted",
								children: focus.note ?? (focus.mode === "work" ? "Фокус" : "Перерыв")
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								variant: "soft",
								onClick: () => focus.running ? pauseFocus() : startFocus(),
								children: focus.running ? "Пауза" : "Дальше"
							}),
							view !== "focus" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
								variant: "ghost",
								onClick: () => openView("focus"),
								children: "Открыть"
							}) : null
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
						className: "grid shrink-0 grid-cols-5 bg-surface pb-safe md:hidden",
						"aria-label": "Основные разделы",
						children: MOBILE.map((item) => {
							const Icon = item.icon;
							const active = !query.trim() && (view === item.id || item.id === "today" && view.startsWith("day:"));
							return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => openView(item.id),
								className: "flex h-14 items-center justify-center",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: cn("flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-xs", active ? "bg-elevated text-fg" : "text-subtle"),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
										className: "size-5",
										strokeWidth: 1.75
									}), item.label]
								})
							}, item.id);
						})
					})
				]
			}),
			task ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("aside", {
				className: "sheet sheet-safe absolute inset-x-0 bottom-0 z-50 flex w-full flex-col bg-surface lg:static lg:inset-auto lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-line",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskDetail, {
					taskId: task.id,
					onClose: () => setSelectedId(null)
				})
			}) : null
		]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PlannerApp, {});
}
//#endregion
export { Home as component };
