export const CRORE = 1e7;

export function formatCrore(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '–';
  return (val / CRORE).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatNum(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '–';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatInt(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '–';
  return Math.round(val).toLocaleString('en-US');
}

export function formatPct(val: number | null | undefined, showPlus = true): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '–';
  const sign = showPlus && val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

export function formatDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeUntil(iso: string | null | undefined): string {
  if (!iso) return 'Paused';
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'Due now';
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const remH = h % 24;
    return `in ${days}d ${remH}h`;
  }
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
