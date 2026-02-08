export function getWeek(date: Date): number {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;

  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const diffInDays = Math.floor((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1;

  return Math.ceil(diffInDays / 7);
}