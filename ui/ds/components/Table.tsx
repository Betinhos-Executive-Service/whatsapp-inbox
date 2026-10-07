import type { HTMLAttributes, ReactNode } from 'react'

export type TableColumn<Row> = {
  key: string
  header: ReactNode
  /** Conteúdo da célula; a primeira coluna recebe mais espaço e a hierarquia. */
  cell: (row: Row) => ReactNode
  /** Largura em CSS grid: `minmax(130px, .8fr)`, `100px`. Padrão: `minmax(0, 1fr)`. */
  width?: string
  /** Some abaixo de 1120px (`compact`) ou de 820px (`mobile`). */
  hideBelow?: 'compact' | 'mobile'
  align?: 'start' | 'end'
}

export type TableProps<Row> = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  columns: TableColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  /** Linha inteira clicável: vira um `button` com seta à direita. */
  onRowClick?: (row: Row) => void
  /** Cor da barra de gravidade à esquerda da linha, com o rótulo acessível. */
  severity?: (row: Row) => { tone: 'success' | 'warning' | 'danger'; label: string } | null
  /** Mostrado quando `rows` está vazio (um `EmptyState`). */
  empty?: ReactNode
  /** Rodapé com contagem e paginação. */
  footer?: ReactNode
  /** Mostra linhas de carregamento no lugar dos dados. */
  loading?: boolean
}

/** Trilhas do grid: `full` com todas as colunas e `compact` (até 1120px) sem as colunas `hideBelow: 'compact'`. */
export function tableTemplates<Row>(columns: TableColumn<Row>[], chevron: boolean) {
  const build = (visible: TableColumn<Row>[]) => [...visible.map((column) => column.width ?? 'minmax(0, 1fr)'), chevron ? '24px' : null].filter(Boolean).join(' ')
  return { full: build(columns), compact: build(columns.filter((column) => column.hideBelow !== 'compact')) }
}

/** Lista operacional em linhas: cabeçalho off-white, barra de gravidade, linha clicável e cabeçalho que some no mobile. */
export function Table<Row>({ columns, rows, rowKey, onRowClick, severity, empty, footer, loading = false, className, style, ...rest }: TableProps<Row>) {
  const template = tableTemplates(columns, Boolean(onRowClick))
  const cellClass = (column: TableColumn<Row>) => ['bt-table__cell', column.hideBelow && `bt-table__cell--hide-${column.hideBelow}`, column.align === 'end' && 'bt-table__cell--end'].filter(Boolean).join(' ')
  const RowTag = onRowClick ? 'button' : 'div'

  return (
    <div className={['bt-table', className].filter(Boolean).join(' ')} style={{ ...style, ['--bt-table-columns' as string]: template.full, ['--bt-table-columns-compact' as string]: template.compact }} role="table" aria-busy={loading || undefined} {...rest}>
      <div className="bt-table__head" role="row">
        {columns.map((column) => <span key={column.key} role="columnheader" className={cellClass(column)}>{column.header}</span>)}
        {onRowClick ? <span aria-hidden="true" /> : null}
      </div>
      {loading ? [0, 1, 2].map((index) => (
        <div key={index} className="bt-table__row bt-table__row--loading" role="row" aria-hidden="true">
          {columns.map((column) => <span key={column.key} className={cellClass(column)}><span className="bt-table__skeleton" /></span>)}
        </div>
      )) : null}
      {!loading && rows.length === 0 ? <div className="bt-table__empty">{empty}</div> : null}
      {!loading ? rows.map((row) => {
        const mark = severity?.(row)
        return (
          <RowTag
            key={rowKey(row)}
            type={onRowClick ? 'button' : undefined}
            className="bt-table__row"
            role="row"
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column, index) => (
              <span key={column.key} role="cell" className={cellClass(column)}>
                {index === 0 && mark ? <i className={`bt-table__severity bt-table__severity--${mark.tone}`} role="img" aria-label={mark.label} /> : null}
                {column.cell(row)}
              </span>
            ))}
            {onRowClick ? (
              <svg className="bt-table__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            ) : null}
          </RowTag>
        )
      }) : null}
      {footer != null ? <div className="bt-table__footer">{footer}</div> : null}
    </div>
  )
}

/** Título e identificador para a primeira coluna: título em uma linha, apoio em 11px. */
export function TableTitle({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <span className="bt-table__title">
      <strong>{title}</strong>
      {meta != null ? <span>{meta}</span> : null}
    </span>
  )
}
