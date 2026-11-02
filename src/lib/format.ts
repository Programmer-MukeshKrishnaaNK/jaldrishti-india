export function formatLatitude(lat: number, digits = 4): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}`
}

export function formatLongitude(lng: number, digits = 4): string {
  return `${Math.abs(lng).toFixed(digits)}° ${lng >= 0 ? 'E' : 'W'}`
}

export function formatZoom(zoom: number): string {
  return `z ${zoom.toFixed(1)}`
}
