function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateForDateInput(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatIsoForDatetimeLocal(isoString: string): string {
  const date = new Date(isoString);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function parseDatetimeLocalToIso(value: string): string {
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

export function parseDateAndTimeToIso(dateValue: string, timeValue: string): string {
  return parseDatetimeLocalToIso(`${dateValue}T${timeValue}`);
}
