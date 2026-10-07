import type { HTMLAttributes, ReactNode } from 'react'

export type PageHeaderProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** Módulo ou seção, em caixa alta acima do título. */
  eyebrow?: ReactNode
  /** Caminho da tela (`<Breadcrumb>`); quando existe, ocupa o lugar do eyebrow. */
  breadcrumb?: ReactNode
  /** O título da página (H1, Centabel Book). Um por página. */
  title: ReactNode
  /** Ao lado do título: contador, `StatusBadge` ou identificador do registro. */
  meta?: ReactNode
  /** Uma linha sobre o que a página faz. */
  description?: ReactNode
  /** Até duas ações: secundária e primária, nesta ordem. */
  actions?: ReactNode
  /** Linha abaixo do cabeçalho, na largura toda: KPIs ou tabs de seção. */
  children?: ReactNode
}

/** Cabeçalho de página: eyebrow ou caminho, título em Centabel Book, descrição e as ações do contexto. */
export function PageHeader({ eyebrow, breadcrumb, title, meta, description, actions, children, className, ...rest }: PageHeaderProps) {
  return (
    <header className={['bt-page-header', className].filter(Boolean).join(' ')} {...rest}>
      <div className="bt-page-header__row">
        <div className="bt-page-header__text">
          {breadcrumb != null
            ? <div className="bt-page-header__breadcrumb">{breadcrumb}</div>
            : eyebrow != null ? <p className="bt-page-header__eyebrow">{eyebrow}</p> : null}
          <div className="bt-page-header__heading">
            <h1 className="bt-page-header__title">{title}</h1>
            {meta != null ? <div className="bt-page-header__meta">{meta}</div> : null}
          </div>
          {description != null ? <p className="bt-page-header__description">{description}</p> : null}
        </div>
        {actions != null ? <div className="bt-page-header__actions">{actions}</div> : null}
      </div>
      {children != null ? <div className="bt-page-header__extra">{children}</div> : null}
    </header>
  )
}
