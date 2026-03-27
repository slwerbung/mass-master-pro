import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export const parseStoredDate = (value: unknown, fallback: Date = new Date(0)): Date => {
  if (value instanceof Date) return isNaN(value.getTime()) ? fallback : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? fallback : d;
  }
  return fallback;
};

export const formatDateTimeSafe = (value: unknown, fallback = '-'): string => {
  const d = parseStoredDate(value, new Date(NaN));
  if (isNaN(d.getTime())) return fallback;
  return format(d, 'dd.MM.yyyy, HH:mm', { locale: de });
};
