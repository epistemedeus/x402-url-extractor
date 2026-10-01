const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const IMF_DATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function known(year, month, day, hour, minute, second, fraction = "000") {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = Number(fraction.padEnd(3, "0"));
  if (!Number.isInteger(millis) || millis > 999) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year
    || back.getUTCMonth() !== month - 1
    || back.getUTCDate() !== day
    || back.getUTCHours() !== hour
    || back.getUTCMinutes() !== minute
    || back.getUTCSeconds() !== second
  ) return null;
  return back.toISOString();
}

// Absent input is unknown. A present value that is not a strict UTC instant
// or an IMF-fix HTTP date is malformed and is not coerced.
export function classifyInstant(value) {
  if (value === undefined || value === null) return { state: "unknown", iso: null };
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    return { state: "malformed", iso: null };
  }
  const iso = value.match(ISO_INSTANT);
  if (iso) {
    const instant = known(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      Number(iso[4]),
      Number(iso[5]),
      Number(iso[6]),
      iso[7] || "000",
    );
    return instant ? { state: "known", iso: instant } : { state: "malformed", iso: null };
  }
  const http = value.match(IMF_DATE);
  if (!http) return { state: "malformed", iso: null };
  const month = MONTHS[http[3]];
  const instant = known(Number(http[4]), month, Number(http[2]), Number(http[5]), Number(http[6]), Number(http[7]));
  if (!instant) return { state: "malformed", iso: null };
  if (WEEKDAYS[new Date(instant).getUTCDay()] !== http[1]) return { state: "malformed", iso: null };
  return { state: "known", iso: instant };
}
