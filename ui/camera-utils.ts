// Partes puras da câmera (testáveis sem navegador).

export function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "O acesso à câmera foi negado. Libere a câmera para o app nas configurações do sistema.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Nenhuma câmera encontrada. Conecte uma câmera e tente de novo.";
  if (name === "NotReadableError") return "A câmera está em uso por outro programa ou falhou ao abrir.";
  return "Câmera indisponível. Confira se ela está conectada e liberada para o app.";
}

/** `foto-aaaa-mm-dd-HHMM.jpg`, no horário local. */
export function photoFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `foto-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.jpg`;
}
