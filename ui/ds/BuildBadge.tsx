const buildDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** `v0.0.1 · dd/mm/aaaa HH:mm` em America/Sao_Paulo. */
export function formatBuild(version: string, isoDate: string) {
  const date = new Date(isoDate)
  return `v${version} · ${Number.isNaN(date.getTime()) ? '' : buildDate.format(date).replace(',', '')}`
}

/** Versão do build sempre visível, discreta, sem capturar clique/foco/toque. */
export function BuildBadge({ version, isoDate }: { version: string; isoDate: string }) {
  return <div className="bt-build-badge" aria-hidden="true">{formatBuild(version, isoDate)}</div>
}
