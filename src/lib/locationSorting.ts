export function naturalLocationSortAsc(a: string, b: string) {
  return a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
}

export function naturalLocationSortDesc(a: string, b: string) {
  return naturalLocationSortAsc(b, a);
}
