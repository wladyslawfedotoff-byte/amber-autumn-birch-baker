import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, CalendarRange, Car, Fuel, Inbox, LayoutGrid, Moon, ShieldCheck, Sun, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner, CheckCircle, Chip, Counter, EmptyState, GroupedCard, IconBadge, InfoCard, ListRow, SearchField, SegmentedControl, SheetHeader, TextField, Tile, Toggle } from "@/components/ui/kit";
import { COLOR_TOKENS, ICON_COLORS } from "@/lib/design/tokens";

/** Living catalogue of the design tokens and the UI kit (hidden: reachable by URL only). */
export const Route = createFileRoute("/kit")({ component: KitPage, head: () => ({ meta: [{ title: "Пора — дизайн-код" }, { name: "robots", content: "noindex" }] }) });

function H({ children }: { children: string }) {
  return <h2 className="mt-6 mb-2 px-1 text-title font-bold">{children}</h2>;
}
function Cap({ children }: { children: string }) {
  return <p className="mt-3 mb-1 px-1 text-caption text-secondary-label">{children}</p>;
}

function KitPage() {
  const [dark, setDark] = useState(false);
  const [toggle, setToggle] = useState(true);
  const [seg, setSeg] = useState<"day" | "week" | "month">("week");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = dark ? "dark" : "light";
    return () => {
      if (before) root.dataset.theme = before;
    };
  }, [dark]);

  return (
    <div className="h-full overflow-y-auto bg-bg text-label">
      <div className="mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-16">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-large leading-tight font-bold tracking-tight">Дизайн-код</h1>
          <Button size="icon" variant="plain" aria-label={dark ? "Светлая тема" : "Тёмная тема"} onClick={() => setDark((d) => !d)}>
            {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </div>
        <p className="px-1 text-caption text-secondary-label">Токены и компоненты «Поры». Страница не видна в меню.</p>

        <H>Цвета</H>
        <div className="grid grid-cols-3 gap-2">
          {COLOR_TOKENS.map((name) => (
            <div key={name} className="menu-card rounded-card p-2">
              <span className="block h-8 rounded-sm border border-separator" style={{ background: `var(--${name})` }} />
              <span className="mt-1 block truncate text-caption text-secondary-label">{name}</span>
            </div>
          ))}
        </div>
        <Cap>Палитра значков</Cap>
        <div className="flex flex-wrap gap-2">
          {ICON_COLORS.map((name) => (
            <span key={name} className="flex flex-col items-center gap-1">
              <IconBadge icon={Bell} color={name} size="lg" />
              <span className="text-[0.625rem] text-tertiary-label">{name}</span>
            </span>
          ))}
        </div>

        <H>Шрифт</H>
        <div className="menu-card space-y-1 rounded-card p-3">
          <p className="text-large leading-tight font-bold">Заголовок 34</p>
          <p className="text-title font-semibold">Раздел 20</p>
          <p className="text-body">Основной текст 15</p>
          <p className="text-body text-secondary-label">Вторичный текст 15</p>
          <p className="text-caption text-tertiary-label">Подпись 12</p>
        </div>

        <H>Отступы и радиусы</H>
        <div className="flex items-end gap-2">
          {[1, 2, 3, 4, 6, 8].map((n) => (
            <span key={n} className="flex flex-col items-center gap-1">
              <span className="block bg-accent" style={{ width: `var(--space-${n})`, height: `var(--space-${n})` }} />
              <span className="text-[0.625rem] text-tertiary-label">{n * 4}</span>
            </span>
          ))}
          <span className="flex-1" />
          {["sm", "md", "lg", "sheet"].map((r) => (
            <span key={r} className="flex flex-col items-center gap-1">
              <span className="block size-8 border-2 border-accent" style={{ borderRadius: `var(--r-${r})` }} />
              <span className="text-[0.625rem] text-tertiary-label">{r}</span>
            </span>
          ))}
        </div>

        <H>Кнопки</H>
        {(["primary", "secondary", "plain", "destructive"] as const).map((variant) => (
          <div key={variant} className="mt-2 grid grid-cols-3 gap-2">
            <Button variant={variant}>{variant === "destructive" ? "Удалить" : "Обычная"}</Button>
            <Button variant={variant} className={variant === "secondary" || variant === "plain" ? "bg-accent/10" : "opacity-80"}>
              Нажатие
            </Button>
            <Button variant={variant} disabled>
              Отключена
            </Button>
          </div>
        ))}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button variant="primary" loading>
            Сохраняю
          </Button>
          <Button variant="secondary" size="sm">
            Маленькая
          </Button>
        </div>

        <H>Поля</H>
        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
          <TextField label="Обычное" placeholder="Введите текст" />
          <TextField label="Ошибка" defaultValue="abc" state="error" helper="Введите корректные данные" />
          <TextField label="С фокусом" placeholder="Введите текст" className="[&_input]:border-accent [&_input]:ring-2 [&_input]:ring-accent/25" />
          <TextField label="Успех" defaultValue="Кроссовер" state="success" />
          <TextField label="Заполненное" defaultValue="Замена масла" />
          <TextField label="Отключено" placeholder="Введите текст" disabled />
        </div>
        <Cap>Поиск</Cap>
        <SearchField value={query} onChange={setQuery} placeholder="Поиск списков" />

        <H>Состояния</H>
        <div className="space-y-2">
          <Banner tone="success" title="Задача выполнена" subtitle="Перенесена в «Выполненные»" onClose={() => {}} />
          <Banner tone="error" title="Не удалось сохранить" subtitle="Нет связи с сервером, повторим позже" onClose={() => {}} />
          <Banner tone="info" title="Обратите внимание" subtitle="Пробег обновлялся месяц назад" onClose={() => {}} />
          <Banner tone="warning" title="Скоро срок" subtitle="Замена масла через 300 км" onClose={() => {}} />
        </div>

        <H>Карточки</H>
        <div className="space-y-2">
          <InfoCard icon={Car} color="blue" title="Кроссовер" value="84 300 км" subtitle="Обновлено сегодня" onClick={() => {}} />
          <InfoCard icon={Fuel} color="orange" title="Расход" value="8,2 л/100 км" subtitle="По двум заправкам" onClick={() => {}} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Tile icon={Inbox} color="indigo" label="Входящие" count={6} onClick={() => {}} />
          <Tile icon={CalendarRange} color="orange" label="Завтра" count={0} active onClick={() => {}} />
        </div>

        <H>Строки</H>
        <GroupedCard title="Варианты">
          <ListRow icon={LayoutGrid} color="mint" title="Навигация" value="5 вкладок" onClick={() => {}} />
          <ListRow icon={Wrench} color="grey" title="С подзаголовком" subtitle="Замена масла · через 300 км" counter={2} onClick={() => {}} />
          <ListRow icon={Bell} color="red" title="Переключатель" toggle={{ checked: toggle, onChange: setToggle }} />
          <ListRow title="Раскрывается" value="Нет" expanded={toggle} onClick={() => setToggle(!toggle)}>
            {toggle ? <p className="px-3 pb-3 text-caption text-secondary-label">Редактор под строкой, как в карточке задачи.</p> : null}
          </ListRow>
          <ListRow icon={ShieldCheck} color="green" title="Загрузка" loading onClick={() => {}} />
          <ListRow icon={Bell} color="purple" title="Отключена" disabled onClick={() => {}} />
          <ListRow icon={Trash2} title="Удалить" destructive onClick={() => {}} />
        </GroupedCard>
        <GroupedCard title="Свёрнутая" count={3} folded onFold={() => {}} />

        <H>Прочее</H>
        <SegmentedControl
          label="Вид"
          value={seg}
          onChange={setSeg}
          options={[
            { id: "day", label: "День" },
            { id: "week", label: "Неделя" },
            { id: "month", label: "Месяц" },
          ]}
        />
        <div className="mt-2">
          <SegmentedControl
            label="Приоритет"
            options={[{ id: "0", label: "Нет" }, { id: "1", label: "Низкий" }, { id: "2", label: "Средний" }, { id: "3", label: "Высокий", tone: "danger" }]}
            value="3"
            onChange={() => {}}
          />
        </div>
        <div className="menu-card mt-2 flex items-center gap-3 rounded-card px-3 py-2">
          <span className="flex-1 text-body">Переключатель</span>
          <Toggle label="Вкл" checked={toggle} onChange={setToggle} />
          <Toggle label="Отключён" checked={false} onChange={() => {}} disabled />
          <Counter value={12} />
          <Counter value={3} tone="danger" />
        </div>
        <div className="menu-card mt-2 flex flex-wrap items-center gap-3 rounded-card px-3 py-2" aria-label="Отметки и пилюли">
          <span className="text-body">Отметка</span>
          <CheckCircle checked={false} />
          <CheckCircle checked={false} ring="border-danger" />
          <CheckCircle checked />
          <CheckCircle checked={false} size="sm" />
          <CheckCircle checked size="sm" />
          <Chip tone="tint">Обновить пробег</Chip>
          <Chip>завтра</Chip>
          <Chip tone="outline">25 окт. ×</Chip>
          <Chip tone="off">10:00 ↺</Chip>
          <Chip tone="on">Завтра</Chip>
        </div>
        <div className="menu-card mt-2 rounded-card">
          <SheetHeader title="Новая задача" onCancel={() => {}} onDone={() => {}} />
        </div>
        <div className="menu-card mt-2 rounded-card">
          <EmptyState icon={Inbox} title="Пока пусто" text="Добавьте первую задачу — она появится здесь." action={<Button variant="primary">Добавить</Button>} />
        </div>
      </div>
    </div>
  );
}
