export type QuickTask = {
  title: string;
  due: string | null;
  startAt: string | null;
  endAt: string | null;
};

const WEEKDAY: Record<string, number> = {
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
  вс: 0,
};

function iso(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

function shift(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function pad(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** 1–7 without a hint means afternoon. «утра» keeps the morning hour. */
function toClock(hour: number, minute: number, hint?: string): string | null {
  if (minute > 59 || hour > 23) return null;
  let h = hour;
  const part = hint?.toLowerCase();
  if (part === "вечера" || part === "вечером" || part === "дня" || part === "днём" || part === "днем") {
    if (h < 12) h += 12;
  } else if (part === "ночи" && h === 12) {
    h = 0;
  } else if (part !== "утра" && h >= 1 && h <= 7) {
    h += 12;
  }
  if (h > 23) return null;
  return pad(h, minute);
}

function weekdayOn(today: string, jsDay: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const add = (jsDay - date.getDay() + 7) % 7;
  return shift(today, add);
}

function cut(text: string, re: RegExp): { text: string; match: RegExpMatchArray | null } {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const match = global.exec(text);
  if (!match) return { text, match: null };
  const next = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
  return { text: next, match };
}

/** Pull a date and a time out of a Russian task line. The rest stays the title. */
export function parseQuick(raw: string, today = iso(new Date())): QuickTask {
  let text = raw.replace(/\s+/g, " ").trim();
  let due: string | null = null;
  let startAt: string | null = null;
  let endAt: string | null = null;

  const range = cut(
    text,
    /(?:^|\s)(?:с|со)\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?:[:.](\d{2}))?(?=\s|$)/i,
  );
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
    const at = cut(
      text,
      /(?:^|\s)(?:в|во|к|на)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s+(утра|вечера|вечером|дня|днём|днем|ночи))?(?!\s*(?:мин|час))(?=\s|$)/i,
    );
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
      if (total < 24 * 60) endAt = pad(Math.floor(total / 60), total % 60);
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
    const week = cut(
      text,
      /(?:^|\s)(?:в|во|на)\s+(понедельник|вторник|сред[ую]|четверг|пятниц[ую]|суббот[ую]|воскресенье|пн|вт|ср|чт|пт|сб|вс)(?=\s|$)/i,
    );
    if (week.match) {
      const day = WEEKDAY[week.match[1]?.toLowerCase() ?? ""];
      if (day != null) {
        text = week.text;
        due = weekdayOn(today, day);
      }
    }
  }

  const title = text.replace(/^[,.:\-–—]+|[,.:\-–—]+$/g, "").replace(/\s+/g, " ").trim();
  return { title, due, startAt, endAt };
}
