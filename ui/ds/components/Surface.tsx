import type { HTMLAttributes, ReactNode } from 'react'

export type SurfaceProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** Rótulo pequeno em caixa alta acima do título. */
  eyebrow?: ReactNode
  /** Título do card (H2, 17px). */
  title?: ReactNode
  /** Ação à direita do título: um `Button` ghost ou compact. */
  action?: ReactNode
  /** Sem padding interno, para tabelas e listas que encostam na borda. */
  flush?: boolean
  /** Padding menor (10px), para cards de métrica e blocos densos. */
  compact?: boolean
  /** Elemento raiz: `section` (padrão), `article` ou `div`. */
  as?: 'section' | 'article' | 'div'
  children?: ReactNode
}

/** Card branco com borda, raio de 12px e sombra baixa; cabeçalho opcional com eyebrow, título e ação. */
export function Surface({ eyebrow, title, action, flush = false, compact = false, as: Tag = 'section', className, children, ...rest }: SurfaceProps) {
  const hasHead = eyebrow != null || title != null || action != null
  return (
    <Tag className={['bt-surface', flush && 'bt-surface--flush', compact && 'bt-surface--compact', className].filter(Boolean).join(' ')} {...rest}>
      {hasHead ? (
        <header className="bt-surface__head">
          <div className="bt-surface__heading">
            {eyebrow != null ? <span className="bt-surface__eyebrow">{eyebrow}</span> : null}
            {title != null ? <h2 className="bt-surface__title">{title}</h2> : null}
          </div>
          {action != null ? <div className="bt-surface__action">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  )
}
