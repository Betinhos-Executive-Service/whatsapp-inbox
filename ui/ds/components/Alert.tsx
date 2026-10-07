import { createContext, useCallback, useContext, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const paths: Record<AlertTone, ReactNode> = {
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  success: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  warning: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  danger: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>,
}
const Icon = ({ tone }: { tone: AlertTone }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[tone]}</svg>
)
const Close = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
)

export type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  tone?: AlertTone
  /** Linha forte; o texto de `children` vem embaixo. */
  title?: ReactNode
  /** Ação ligada ao aviso (um `Button` ghost ou secondary). */
  action?: ReactNode
  /** Mostra o X; chamado ao fechar. */
  onDismiss?: () => void
  children?: ReactNode
}

/** Aviso dentro da página: ícone e texto num bloco suave do tom. Erro usa `role="alert"`; o resto, `role="status"`. */
export function Alert({ tone = 'info', title, action, onDismiss, className, children, ...rest }: AlertProps) {
  return (
    <div className={['bt-alert', `bt-alert--${tone}`, className].filter(Boolean).join(' ')} role={tone === 'danger' ? 'alert' : 'status'} {...rest}>
      <span className="bt-alert__icon"><Icon tone={tone} /></span>
      <div className="bt-alert__body">
        {title != null ? <p className="bt-alert__title">{title}</p> : null}
        {children != null ? <div className="bt-alert__text">{children}</div> : null}
        {action != null ? <div className="bt-alert__action">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="bt-alert__close" aria-label="Fechar aviso" onClick={onDismiss}><Close /></button>
      ) : null}
    </div>
  )
}

export type ToastOptions = {
  tone?: AlertTone
  message: ReactNode
  /** Milissegundos até sumir. Padrão: 4000; `danger` fica até ser fechado. */
  duration?: number
}
type ToastItem = ToastOptions & { id: number; tone: AlertTone }

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null)

/** Envolve o app uma vez; os toasts aparecem no topo, centralizados, um sobre o outro. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((item) => item.id !== id)), [])
  const toast = useCallback((options: ToastOptions) => {
    const item: ToastItem = { tone: 'info', ...options, id: ++seq.current }
    setItems((list) => [...list, item])
    const duration = item.duration ?? (item.tone === 'danger' ? 0 : 4000)
    if (duration > 0) setTimeout(() => dismiss(item.id), duration)
  }, [dismiss])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="bt-toast-region">
        {items.map((item) => (
          <div key={item.id} className={`bt-toast bt-toast--${item.tone}`} role={item.tone === 'danger' ? 'alert' : 'status'}>
            <span className="bt-alert__icon"><Icon tone={item.tone} /></span>
            <span className="bt-toast__text">{item.message}</span>
            <button type="button" className="bt-alert__close" aria-label="Fechar aviso" onClick={() => dismiss(item.id)}><Close /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** `const toast = useToast(); toast({ tone: 'success', message: 'Ocorrência registrada.' })` */
export function useToast() {
  const toast = useContext(ToastContext)
  return useMemo(() => toast ?? (() => { throw new Error('useToast precisa de um ToastProvider acima.') }), [toast])
}
