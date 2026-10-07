import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type MenuAction = { id: string; label: ReactNode; icon?: ReactNode; onSelect: () => void; tone?: 'neutral' | 'danger'; disabled?: boolean }

export type MenuProps = {
  /** O gatilho: normalmente um `Button` de ícone com `aria-label`. Recebe os atributos do menu por `cloneElement`? Não: envolva seu botão e passe `trigger`. */
  trigger: (props: { 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string; onClick: () => void; onKeyDown: (event: KeyboardEvent) => void }) => ReactNode
  actions: MenuAction[]
  /** Alinha o painel à direita do gatilho (padrão) ou à esquerda. */
  align?: 'end' | 'start'
}

/** Menu de ações (⋯): painel na camada superior com itens, setas, Enter e Esc. */
export function Menu({ trigger, actions, align = 'end' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const enabledIndexes = actions.map((action, index) => (action.disabled ? -1 : index)).filter((index) => index >= 0)

  useLayoutEffect(() => {
    const box = boxRef.current
    const panel = panelRef.current
    if (!open || !box || !panel) return
    try { panel.showPopover?.() } catch { /* sem suporte: fixo com z-index alto */ }
    const place = () => {
      const r = box.getBoundingClientRect()
      const width = panel.offsetWidth
      const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
      const below = window.innerHeight - r.bottom - 8
      const up = below < panel.offsetHeight && r.top > below
      panel.style.left = `${left}px`
      panel.style.top = up ? 'auto' : `${r.bottom + 4}px`
      panel.style.bottom = up ? `${window.innerHeight - r.top + 4}px` : 'auto'
    }
    place()
    panel.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const outside = (event: PointerEvent) => { if (!box.contains(event.target as Node) && !panel.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', place, true) }
  }, [open, align])

  useEffect(() => {
    if (open) panelRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]')[active]?.focus()
  }, [open, active])

  const move = (step: number) => setActive((current) => {
    const position = enabledIndexes.indexOf(current)
    return enabledIndexes[(position + step + enabledIndexes.length) % enabledIndexes.length] ?? current
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(enabledIndexes[0] ?? 0); setOpen(true) } return }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); break
      case 'ArrowUp': event.preventDefault(); move(-1); break
      case 'Home': event.preventDefault(); setActive(enabledIndexes[0] ?? 0); break
      case 'End': event.preventDefault(); setActive(enabledIndexes[enabledIndexes.length - 1] ?? 0); break
      case 'Escape': event.preventDefault(); setOpen(false); boxRef.current?.querySelector<HTMLElement>('button')?.focus(); break
      case 'Tab': setOpen(false); break
    }
  }
  const select = (action: MenuAction) => { if (action.disabled) return; setOpen(false); action.onSelect(); boxRef.current?.querySelector<HTMLElement>('button')?.focus() }

  return (
    <div ref={boxRef} className="bt-menu">
      {trigger({ 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, onClick: () => { setActive(enabledIndexes[0] ?? 0); setOpen((current) => !current) }, onKeyDown })}
      {open ? (
        <div ref={panelRef} id={id} role="menu" className="bt-menu__panel" popover="manual" onKeyDown={onKeyDown}>
          {actions.map((action, index) => (
            <button key={action.id} type="button" role="menuitem" tabIndex={index === active ? 0 : -1} disabled={action.disabled} className={['bt-menu__item', action.tone === 'danger' && 'bt-menu__item--danger'].filter(Boolean).join(' ')} onMouseEnter={() => setActive(index)} onClick={() => select(action)}>
              {action.icon != null ? <span className="bt-menu__icon">{action.icon}</span> : null}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
