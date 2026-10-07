import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export type SegmentedOption<T extends string = string> = { value: T; label: ReactNode; disabled?: boolean }

export type SegmentedControlProps<T extends string = string> = {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Nome do grupo para o leitor de tela ("Período", "Modo de exibição"). */
  'aria-label': string
  /** Ocupa toda a largura, com os itens divididos por igual. */
  fullWidth?: boolean
  size?: 'compact' | 'default'
  className?: string
}

/** Seletor de opções mutuamente exclusivas (2 a 5), com o item ativo em navy; setas trocam a opção. */
export function SegmentedControl<T extends string>({ options, value, onChange, fullWidth = false, size = 'default', className, ...rest }: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = options.filter((option) => !option.disabled)

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = enabled.findIndex((option) => option.value === value)
    const next = enabled[(index + step + enabled.length) % enabled.length]
    onChange(next.value)
    ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={['bt-segmented', fullWidth && 'bt-segmented--full', size === 'compact' && 'bt-segmented--compact', className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-value={option.value}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            className={active ? 'bt-segmented__item is-active' : 'bt-segmented__item'}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
