import { useEffect, useId, useRef, type ReactNode } from 'react'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Erro ou exclusão: ícone em danger e o botão principal em danger. */
  tone?: 'neutral' | 'danger'
  /** Ações, secundária e primária. Sem elas, só o X fecha. */
  actions?: ReactNode
  children?: ReactNode
}

/** Caixa centrada para decisão curta (confirmar, excluir, avisar); prende o foco e fecha por Esc e fundo. */
export function Dialog({ open, onClose, title, tone = 'neutral', actions, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className={`bt-dialog bt-dialog--${tone}`} aria-labelledby={`${id}-title`} aria-describedby={children != null ? `${id}-text` : undefined}
      onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="bt-dialog__panel">
        <span className="bt-dialog__icon" aria-hidden="true">
          {tone === 'danger'
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>}
        </span>
        <div className="bt-dialog__body">
          <h2 className="bt-dialog__title" id={`${id}-title`}>{title}</h2>
          {children != null ? <div className="bt-dialog__text" id={`${id}-text`}>{children}</div> : null}
        </div>
        <button type="button" className="bt-dialog__close" aria-label="Fechar" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
        {actions != null ? <div className="bt-dialog__actions">{actions}</div> : null}
      </div>
    </dialog>
  )
}
