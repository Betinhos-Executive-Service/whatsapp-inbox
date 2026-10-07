import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { dampen, resolveSnap, type SheetLevel } from './sheetGesture.ts'

export type SheetProps = {
  open: boolean
  /** Chamado depois da animação de saída (X, Esc, fundo ou arrasto). */
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  /** Ações fixas ao alcance do polegar. */
  footer?: ReactNode
  /** Rótulo do botão que expande para a altura cheia. */
  expandLabel?: string
  children: ReactNode
}

const EXIT_MS = 160

/** Bottom sheet modal em dois níveis (metade e cheio), arrastável pela alça/cabeçalho; <dialog> nativo para foco e Esc. */
export function Sheet({ open, onClose, title, eyebrow, footer, expandLabel = 'Ver detalhes completos', children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; pointer: number } | null>(null)
  const [level, setLevel] = useState<SheetLevel>('half')
  const closeTimer = useRef<number | undefined>(undefined)
  const [closing, setClosing] = useState(false)
  const [notified, setNotified] = useState(false)
  const titleId = useId()

  useEffect(() => {
    window.clearTimeout(closeTimer.current) // reabrir ou fechar pelo pai cancela o onClose atrasado
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) { setLevel('half'); setClosing(false); dialog.showModal() }
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  // Se o pai não fechou dentro do onClose, o sheet volta e aceita fechar de novo.
  useEffect(() => {
    if (!notified) return
    setNotified(false)
    if (open) setClosing(false)
  }, [notified, open])

  function requestClose() {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => { onClose(); setNotified(true) }, EXIT_MS)
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0 || drag.current || (event.target as HTMLElement).closest('button')) return // ignora segundo dedo e botões
    drag.current = { y: event.clientY, t: performance.now(), pointer: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    panelRef.current?.setAttribute('data-dragging', '')
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId || !panelRef.current) return
    // Transform direto no painel: não recalcula estilo dos filhos.
    panelRef.current.style.transform = `translateY(calc(var(--bt-sheet-offset) + ${dampen(event.clientY - start.y)}px))`
  }
  function onPointerCancel(event: PointerEvent<HTMLElement>) {
    if (!drag.current || drag.current.pointer !== event.pointerId) return
    drag.current = null
    panelRef.current?.removeAttribute('data-dragging')
    if (panelRef.current) panelRef.current.style.transform = ''
  }
  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const start = drag.current
    if (!start || start.pointer !== event.pointerId || !panelRef.current) return
    drag.current = null
    panelRef.current.removeAttribute('data-dragging')
    panelRef.current.style.transform = ''
    const next = resolveSnap({ dy: event.clientY - start.y, ms: performance.now() - start.t, level, height: panelRef.current.offsetHeight })
    if (next === 'close') requestClose()
    else setLevel(next)
  }

  return (
    <dialog
      ref={dialogRef}
      className="bt-sheet"
      data-level={level}
      data-closing={closing ? '' : undefined}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); requestClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <div ref={panelRef} className="bt-sheet__panel">
        <header className="bt-sheet__head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
          <span className="bt-sheet__handle" aria-hidden="true" />
          <div className="bt-sheet__heading">
            {eyebrow != null ? <span className="bt-sheet__eyebrow">{eyebrow}</span> : null}
            <h2 className="bt-sheet__title" id={titleId}>{title}</h2>
          </div>
          <button type="button" className="bt-sheet__close" aria-label="Fechar" onClick={requestClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </header>
        <div className="bt-sheet__body">
          {children}
          {level === 'half' ? <button type="button" className="bt-sheet__expand" onClick={() => setLevel('full')}>{expandLabel}</button> : null}
        </div>
        {footer != null ? <footer className="bt-sheet__foot">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
