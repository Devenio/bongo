// Parses durations like "1h30m", "45s", "2d" into milliseconds.
const UNITS = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000, ms: 1 };

export function parseDuration(input) {
  let total = 0;
  for (const [, num, unit] of input.matchAll(/(\d+)(ms|d|h|m|s)/g)) {
    total += Number(num) * UNITS[unit];
  }
  return total;
}

export function formatDuration(ms) {
  const parts = [];
  for (const [unit, size] of Object.entries(UNITS)) {
    if (ms >= size) {
      parts.push(`${Math.floor(ms / size)}${unit}`);
      ms %= size;
    }
  }
  return parts.join('');
}
