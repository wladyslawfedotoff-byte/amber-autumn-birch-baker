/** «1 ждёт отправки», «3 ждут отправки», «5 ждут отправки». */
export function pendingLabel(count: number): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  const verb = n > 10 && n < 20 ? "ждут" : last === 1 ? "ждёт" : "ждут";
  return `${count} ${verb} отправки`;
}
