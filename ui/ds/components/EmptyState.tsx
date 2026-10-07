import type { HTMLAttributes, ReactNode } from 'react'

export type EmptyStateProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** Ícone Lucide; 36px no padrão, 24px no compacto. */
  icon?: ReactNode
  /** O contexto: "Nenhuma ocorrência encontrada para estes filtros." */
  title: ReactNode
  /** Explicação curta e o próximo passo. */
  children?: ReactNode
  /** Botão que leva ao próximo passo, quando existir. */
  action?: ReactNode
  /** Erro ou falha de conexão: ícone em danger. */
  tone?: 'neutral' | 'danger'
  /** Versão de uma linha, para blocos pequenos (card, painel lateral). */
  compact?: boolean
  /** Centraliza (padrão) ou alinha à esquerda, como no shell. */
  align?: 'center' | 'start'
}

/** Estado vazio ou de erro: ícone, título, explicação curta e a ação que leva ao próximo passo. */
export function EmptyState({ icon, title, children, action, tone = 'neutral', compact = false, align = 'center', className, ...rest }: EmptyStateProps) {
  return (
    <section
      className={['bt-empty', `bt-empty--${tone}`, `bt-empty--${align}`, compact && 'bt-empty--compact', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon != null ? <span className="bt-empty__icon" aria-hidden="true">{icon}</span> : null}
      <div className="bt-empty__body">
        <h2 className="bt-empty__title">{title}</h2>
        {children != null ? <p className="bt-empty__text">{children}</p> : null}
        {action != null ? <div className="bt-empty__action">{action}</div> : null}
      </div>
    </section>
  )
}
