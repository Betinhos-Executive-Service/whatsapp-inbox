import type { HTMLAttributes, ReactNode } from 'react'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** Um dos cinco estados visuais do sistema. */
  tone?: StatusTone
  /** Ponto colorido antes do texto: segundo sinal além da cor, útil em listas densas. */
  dot?: boolean
  /** Ícone Lucide de 12px antes do texto. */
  icon?: ReactNode
  /** Rótulo curto, sem ponto final. */
  children: ReactNode
}

/** Classes do badge, para reaproveitar o visual em outro elemento. */
export function statusBadgeClassName(tone: StatusTone = 'neutral', extra?: string) {
  return ['bt-badge', `bt-badge--${tone}`, extra].filter(Boolean).join(' ')
}

/** Badge de status em pílula: texto forte sobre fundo suave, um par de tokens por tom. */
export function StatusBadge({ tone = 'neutral', dot = false, icon, className, children, ...rest }: StatusBadgeProps) {
  return (
    <span className={statusBadgeClassName(tone, className)} {...rest}>
      {dot ? <span className="bt-badge__dot" aria-hidden="true" /> : null}
      {icon != null ? <span className="bt-badge__icon" aria-hidden="true">{icon}</span> : null}
      <span className="bt-badge__label">{children}</span>
    </span>
  )
}
