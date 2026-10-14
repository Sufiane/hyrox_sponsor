const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_MINUTE = 60;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatFinishTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}
