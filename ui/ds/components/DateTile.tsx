import type { HTMLAttributes } from 'react'

export type DateTileProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** Data do serviço ou ação; `Date` ou ISO. */
  date: Date | string
  /** Atrasado: fundo em danger. O rótulo "Atrasado" vai no card, não aqui. */
  overdue?: boolean
  /** 40 × 43px (listas) ou 48 × 55px (cards de agenda). */
  size?: 'compact' | 'default'
}

const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' })
const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' })
const full = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' })

/** Partes do bloco de data em America/Sao_Paulo: dia com dois dígitos e mês abreviado sem ponto. */
export function dateTileParts(input: Date | string) {
  // "2026-10-06" é um dia do calendário, não um instante UTC: lido ao meio-dia local para não voltar um dia.
  const dateOnly = typeof input === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) : null
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12) : typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return { day: '--', month: '', label: 'Data inválida' }
  return { day: day.format(date), month: month.format(date).replace('.', ''), label: full.format(date) }
}

/** Bloco de data em navy, dia grande e mês abaixo, para linhas de agenda. */
export function DateTile({ date, overdue = false, size = 'default', className, ...rest }: DateTileProps) {
  const parts = dateTileParts(date)
  return (
    <time
      className={['bt-date-tile', size === 'compact' && 'bt-date-tile--compact', overdue && 'bt-date-tile--overdue', className].filter(Boolean).join(' ')}
      dateTime={typeof date === 'string' ? date : date.toISOString()}
      aria-label={overdue ? `${parts.label}, atrasado` : parts.label}
      {...rest}
    >
      <strong className="bt-date-tile__day" aria-hidden="true">{parts.day}</strong>
      <span className="bt-date-tile__month" aria-hidden="true">{parts.month}</span>
    </time>
  )
}
