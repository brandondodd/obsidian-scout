/**
 * Small formatters shared by the providers and the UI.
 *
 * Kept out of the components because a provider builds some of these strings
 * itself, and a provider has no business importing a `.tsx` file.
 */

/** One decimal place, always. A score of eight is written 8.0 everywhere. */
export function oneDecimal(value: number): string {
	return (Math.round(value * 10) / 10).toFixed(1);
}

/** `1h 42m`, or `48m` when it is under the hour. */
export function formatRuntime(minutes: number | undefined): string | undefined {
	if (!minutes || minutes <= 0) return undefined;
	const hours = Math.floor(minutes / 60);
	const rest = Math.round(minutes % 60);
	if (hours === 0) return `${rest}m`;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `1 season`, `6 seasons`. */
export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** A language's name in English, from its code, or the code if unknown. */
export function languageName(code: string | undefined): string | undefined {
	if (!code) return undefined;
	try {
		return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
	} catch {
		return code;
	}
}

/**
 * A `YYYY-MM-DD` date, read as that day wherever the reader is.
 *
 * Noon UTC, because midnight lands on the previous day anywhere west of
 * Greenwich, which is how a Thursday episode turns into a Wednesday one.
 */
function parseDay(raw: string): Date | null {
	const parsed = new Date(`${raw.slice(0, 10)}T12:00:00Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayFormat(raw: string, options: Intl.DateTimeFormatOptions): string {
	const day = parseDay(raw);
	return day
		? day.toLocaleDateString(undefined, { timeZone: "UTC", ...options })
		: raw;
}

/** `12 Mar 2016`. */
export function longDate(raw: string): string {
	return dayFormat(raw, { day: "numeric", month: "short", year: "numeric" });
}

/** `Thu, 5 Nov`. */
export function shortDate(raw: string): string {
	return dayFormat(raw, { weekday: "short", day: "numeric", month: "short" });
}

/** `Thursday`. */
export function weekday(raw: string): string {
	return dayFormat(raw, { weekday: "long" });
}

/** Whole days from `today` to `raw`, both `YYYY-MM-DD`. Negative in the past. */
export function daysUntil(raw: string, today: string): number {
	const from = parseDay(today);
	const to = parseDay(raw);
	if (!from || !to) return 0;
	return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** `today`, `tomorrow`, `in 6 days`. */
export function relativeDay(raw: string, today: string): string {
	const days = daysUntil(raw, today);
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${days} days`;
}

/** Today in the reader's own time zone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}
