/**
 * Coordenadas a partir do que a pessoa cola: "-23.55, -46.63" ou um link do Google Maps
 * (…/@-23.55,-46.63,17z, ?q=-23.55,-46.63, ?query=…, !3d-23.55!4d-46.63). null = não achou.
 */
export function parseLocation(input: string): { lat: number; lng: number } | null {
  const text = decodeURIComponent(input.trim().replace(/\+/g, " "));
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const lat = Number(m[1].replace(",", "."));
    const lng = Number(m[2].replace(",", "."));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Número digitado → só dígitos; sem DDI (10 ou 11 dígitos) assume Brasil. Igual à regra do servidor. */
export function phoneDigits(phone: string): string | null {
  let digits = phone.replace(/\D/g, "").replace(/^00/, "");
  if (!phone.trim().startsWith("+") && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
