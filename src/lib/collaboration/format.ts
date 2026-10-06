// "12 min", "1 h 5 min" -- how long someone has been inactive.
export function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.floor(seconds / 60))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}
