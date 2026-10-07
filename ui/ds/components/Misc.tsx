import { useId, type HTMLAttributes, type ReactNode } from 'react'

/* Componentes pequenos: Tooltip, Pagination, Skeleton, Spinner, Avatar, Breadcrumb, Progress e BottomNav. */

export type TooltipProps = { text: string; children: ReactNode; placement?: 'top' | 'bottom' }
/** Dica curta ao passar o mouse ou focar; só para complementar, nunca para informação essencial. */
export function Tooltip({ text, children, placement = 'top' }: TooltipProps) {
  const id = useId()
  return (
    <span className={`bt-tooltip bt-tooltip--${placement}`}>
      <span className="bt-tooltip__anchor" aria-describedby={id} tabIndex={-1}>{children}</span>
      <span role="tooltip" id={id} className="bt-tooltip__bubble">{text}</span>
    </span>
  )
}

export type PaginationProps = {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
  /** Nome do que é contado: "ocorrências". */
  noun?: string
}
/** Contagem "1–20 de 128 ocorrências" e botões Anterior e Próxima. */
export function Pagination({ page, pageSize, total, onChange, noun }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <nav className="bt-pagination" aria-label="Paginação">
      <span className="bt-pagination__count" role="status">{total === 0 ? `Nenhum resultado` : `${start}–${end} de ${total}${noun ? ` ${noun}` : ''}`}</span>
      <span className="bt-pagination__buttons">
        <button type="button" className="bt-pagination__button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
        <span className="bt-pagination__page" aria-current="page">{page} / {pages}</span>
        <button type="button" className="bt-pagination__button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</button>
      </span>
    </nav>
  )
}

export type SkeletonProps = HTMLAttributes<HTMLSpanElement> & { width?: number | string; height?: number | string; shape?: 'text' | 'rect' | 'circle' }
/** Marcação do formato final enquanto o conteúdo carrega; nunca para estado vazio. */
export function Skeleton({ width, height, shape = 'text', className, style, ...rest }: SkeletonProps) {
  return <span className={['bt-skeleton', `bt-skeleton--${shape}`, className].filter(Boolean).join(' ')} style={{ width: width ?? (shape === 'circle' ? undefined : '100%'), height, ...style }} aria-hidden="true" {...rest} />
}

/** Indicador girando de 800ms com rótulo acessível; para ações locais, não para página inteira. */
export function Spinner({ label = 'Carregando', size = 20 }: { label?: string; size?: number }) {
  return (
    <span className="bt-spinner" role="status" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
    </span>
  )
}

export type AvatarProps = { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }
/** Iniciais do nome. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
/** Foto ou iniciais em círculo; o nome fica no `title` e no texto acessível. */
export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  return (
    <span className={`bt-avatar bt-avatar--${size}`} title={name} role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  )
}

export type Crumb = { label: ReactNode; href?: string }
/** Caminho da tela: só quando há hierarquia real (lista → detalhe). */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="bt-breadcrumb" aria-label="Caminho">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={index}>
              {item.href && !last ? <a href={item.href}>{item.label}</a> : <span aria-current={last ? 'page' : undefined}>{item.label}</span>}
              {!last ? <span className="bt-breadcrumb__sep" aria-hidden="true">›</span> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export type ProgressProps = { value: number; max?: number; label: string; tone?: 'info' | 'success' | 'warning' | 'danger'; showValue?: boolean }
/** Barra de progresso de 6px com rótulo e valor. */
export function Progress({ value, max = 100, label, tone = 'info', showValue = true }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={`bt-progress bt-progress--${tone}`}>
      <div className="bt-progress__head"><span>{label}</span>{showValue ? <strong>{Math.round(pct)}%</strong> : null}</div>
      <div className="bt-progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span className="bt-progress__bar" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  )
}

export type BottomNavItem = { id: string; label: string; href: string; icon: ReactNode; badge?: ReactNode }
/** Barra flutuante inferior do celular com até cinco destinos; some no desktop. */
export function BottomNav({ items, activeId }: { items: BottomNavItem[]; activeId: string }) {
  return (
    <nav className="bt-bottom-nav" aria-label="Atalhos" style={{ ['--bt-nav-count' as string]: items.length }}>
      {items.slice(0, 5).map((item) => (
        <a key={item.id} href={item.href} className="bt-bottom-nav__item" aria-current={item.id === activeId ? 'page' : undefined}>
          <span className="bt-bottom-nav__icon" aria-hidden="true">{item.icon}{item.badge != null ? <span className="bt-bottom-nav__badge">{item.badge}</span> : null}</span>
          <span className="bt-bottom-nav__label">{item.label}</span>
        </a>
      ))}
    </nav>
  )
}
