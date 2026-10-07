import { useEffect, useId, useRef, type ReactNode } from 'react'

export type DrawerProps = {
  open: boolean
  /** Chamado ao fechar por X, Esc ou clique no fundo. */
  onClose: () => void
  /** Título acessível do painel. */
  title: ReactNode
  /** Rótulo pequeno acima do título. */
  eyebrow?: ReactNode
  /** 520px (`default`) ou 720px (`wide`); largura total abaixo de 560px. */
  size?: 'default' | 'wide'
  /** Barra fixa no rodapé com as ações (secundária, primária). */
  footer?: ReactNode
  children: ReactNode
}

/** Painel lateral pela direita, modal: prende e devolve o foco, fecha por X, Esc e fundo, rola só o conteúdo. */
export function Drawer({ open, onClose, title, eyebrow, size = 'default', footer, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  // <dialog> nativo: camada superior, foco preso e Esc de graça; só sincronizamos com `open`.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={size === 'wide' ? 'bt-drawer bt-drawer--wide' : 'bt-drawer'}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="bt-drawer__panel">
        <header className="bt-drawer__head">
          <div className="bt-drawer__heading">
            {eyebrow != null ? <span className="bt-drawer__eyebrow">{eyebrow}</span> : null}
            <h2 className="bt-drawer__title" id={titleId}>{title}</h2>
          </div>
          <button type="button" className="bt-drawer__close" aria-label="Fechar painel" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </header>
        <div className="bt-drawer__body">{children}</div>
        {footer != null ? <footer className="bt-drawer__foot">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
