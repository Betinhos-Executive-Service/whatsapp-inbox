import type { HTMLAttributes, ReactNode } from 'react'

export type PageToolbarVariant = 'filters' | 'utility'

export type PageToolbarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /**
   * `filters`: busca, segmentos, selects e tabs; quebra linha no celular.
   * `utility`: barra do ambiente (§10.2.1); some no celular, onde o header mobile fica só com atualizar.
   */
  variant?: PageToolbarVariant
  /** Lado esquerdo: filtros, ou o `environment-pill` na barra utilitária. */
  start?: ReactNode
  /** Lado direito: ações secundárias e, por último, atualizar. A ação primária fica no `PageHeader`. */
  end?: ReactNode
  /** Rótulo da barra para leitor de tela. */
  label?: string
}

export function pageToolbarClassName(variant: PageToolbarVariant = 'filters', className?: string) {
  return ['bt-page-toolbar', `bt-page-toolbar--${variant}`, className].filter(Boolean).join(' ')
}

/** Barra abaixo do `PageHeader`: filtros da tela ou contexto do ambiente com ações operacionais. */
export function PageToolbar({ variant = 'filters', start, end, label, className, ...rest }: PageToolbarProps) {
  return (
    <div role="toolbar" aria-label={label ?? (variant === 'utility' ? 'Ambiente' : 'Filtros')} className={pageToolbarClassName(variant, className)} {...rest}>
      {start != null ? <div className="bt-page-toolbar__start">{start}</div> : null}
      {end != null ? <div className="bt-page-toolbar__end">{end}</div> : null}
    </div>
  )
}
