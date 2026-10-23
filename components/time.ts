export const fa = (n: number | string) => Number(n).toLocaleString("fa-IR");

/** "۲۵ ثانیه پیش" style relative time, like the console. */
export function ago(unixSec: number): string {
  const d = Math.max(0, Date.now() / 1000 - unixSec);
  if (d < 60) return `${fa(Math.floor(d))} ثانیه پیش`;
  if (d < 3600) return `${fa(Math.floor(d / 60))} دقیقه پیش`;
  if (d < 86400) return `${fa(Math.floor(d / 3600))} ساعت پیش`;
  return `${fa(Math.floor(d / 86400))} روز پیش`;
}

export const jalali = (iso: string | number, opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian", opts).format(typeof iso === "number" ? new Date(iso * 1000) : new Date(iso));
