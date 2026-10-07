import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { controlClassName, type ControlSize } from './Field.tsx'

export type SearchBoxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'value' | 'onChange' | 'type'> & {
  /** Texto atual (controlado). */
  value: string
  /** Chamado a cada tecla, com o texto novo. */
  onChange: (value: string) => void
  /** Chamado depois de uma pausa na digitação (e no limpar), para disparar a busca de verdade. */
  onSearch?: (value: string) => void
  /** Pausa, em ms, antes de chamar `onSearch`. */
  debounce?: number
  /** Mostra o indicador girando no lugar da lupa enquanto a busca roda. */
  loading?: boolean
  size?: ControlSize
  /** Obrigatório: a busca não tem rótulo visível. */
  'aria-label': string
}

const spin = (
  <svg className="bt-search__spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)
const lens = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
)

/** Busca de página: lupa, campo e botão de limpar numa caixa off-white; Esc limpa. */
export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, onChange, onSearch, debounce = 250, loading = false, size = 'default', className, disabled, placeholder = 'Buscar', onKeyDown, ...rest },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const latest = useRef(onSearch)
  latest.current = onSearch
  const first = useRef(true)

  // A busca real só dispara depois da pausa; a primeira renderização não busca.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (!latest.current) return
    const timer = setTimeout(() => latest.current?.(value), debounce)
    return () => clearTimeout(timer)
  }, [value, debounce])

  const clear = () => {
    onChange('')
    inputRef.current?.focus()
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value) { event.preventDefault(); clear() }
    onKeyDown?.(event)
  }

  return (
    <div className={controlClassName('search', size, false, className)}>
      <span className="bt-search__icon" aria-hidden="true">{loading ? spin : lens}</span>
      <input
        ref={(node) => {
          inputRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="search"
        className="bt-control__input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keyDown}
        {...rest}
      />
      {value && !disabled ? (
        <button type="button" className="bt-search__clear" aria-label="Limpar busca" onClick={clear}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      ) : null}
      {loading ? <span className="bt-search__status" role="status">Buscando…</span> : null}
    </div>
  )
})
