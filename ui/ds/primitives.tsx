import type { CSSProperties, ReactNode } from 'react'

type Space = '1' | '2' | '3' | '4' | '5' | '6' | '8'
type LayoutProps = { gap?: Space; className?: string; children?: ReactNode }

function layout(base: string, { gap, className, children }: LayoutProps, extra?: CSSProperties) {
  const style = { ...(gap ? { '--bt-gap': `var(--bt-space-${gap})` } : {}), ...extra } as CSSProperties
  return <div className={className ? `${base} ${className}` : base} style={style}>{children}</div>
}

/** Empilha na vertical com espaçamento da escala. */
export function Stack(props: LayoutProps) { return layout('bt-stack', props) }
/** Itens em linha que quebram quando falta espaço. */
export function Cluster(props: LayoutProps) { return layout('bt-cluster', props) }
/** Dois lados opostos na mesma linha. */
export function Split(props: LayoutProps) { return layout('bt-split', props) }
/** Colunas automáticas com largura mínima. */
export function Grid({ min, ...props }: LayoutProps & { min?: number }) {
  return layout('bt-grid', props, min ? ({ '--bt-grid-min': `${min}px` } as CSSProperties) : undefined)
}
