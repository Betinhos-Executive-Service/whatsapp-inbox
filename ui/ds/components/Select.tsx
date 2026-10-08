import {
  forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react'
import { controlClassName, useControl, type ControlSize } from './Field.tsx'

export type SelectOption = {
  value: string
  label: string
  /** Segunda linha da opção: cliente da pessoa, placa do veículo, etc. Também entra na busca. */
  subtitle?: string
  /** Texto extra só para a busca (apelido, documento, código). */
  search?: string
  /** Título do grupo. Opções seguidas com o mesmo grupo ficam sob um cabeçalho. */
  group?: string
  /** Ícone ou marcador antes do rótulo (ícone Lucide de 16px, ponto de status). */
  icon?: ReactNode
  disabled?: boolean
}

type SelectBase = {
  options: SelectOption[]
  /** Texto do gatilho sem valor. */
  placeholder?: string
  /** Mostra o campo de busca no painel. Desligue em listas curtas e fixas (status, hora). */
  searchable?: boolean
  searchPlaceholder?: string
  /** Mostra o botão de limpar. Padrão: ligado, exceto em campo obrigatório. */
  clearable?: boolean
  /** Busca remota: recebe o texto digitado; quem chama atualiza `options`. Desliga o filtro local. */
  onSearchChange?: (query: string) => void
  /** Permite criar: quando o texto digitado não existe, o painel oferece "Adicionar …" e chama esta função. */
  onCreate?: (label: string) => void
  /** Mostra `loadingText` no painel enquanto as opções chegam. */
  loading?: boolean
  loadingText?: ReactNode
  emptyText?: ReactNode
  size?: ControlSize
  invalid?: boolean
  disabled?: boolean
  required?: boolean
  id?: string
  /** Gera `<input type="hidden">` com o valor, para envio em formulário nativo. */
  name?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

export type SelectProps = SelectBase & (
  | { multiple?: false; value: string | null; onChange: (value: string | null) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
)

/** Minúsculas e sem acento, para a busca achar "joao" em "João". */
export function normalizeSearch(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Mantém as opções em que todas as palavras digitadas aparecem no rótulo, no subtítulo ou em `search`. */
export function filterOptions(options: SelectOption[], query: string) {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return options
  return options.filter((option) => {
    const haystack = normalizeSearch(`${option.label} ${option.subtitle ?? ''} ${option.search ?? ''}`)
    return tokens.every((token) => haystack.includes(token))
  })
}

/** Agrupa opções seguidas com o mesmo `group`, preservando o índice global de cada uma (usado pelo teclado). */
function groupRuns(options: SelectOption[]) {
  const runs: { group?: string; options: { option: SelectOption; index: number }[] }[] = []
  options.forEach((option, index) => {
    const last = runs[runs.length - 1]
    if (last && last.group === option.group) last.options.push({ option, index })
    else runs.push({ group: option.group, options: [{ option, index }] })
  })
  return runs
}

/** Posiciona o painel colado ao controle; abre para cima quando falta espaço embaixo. */
function placePanel(box: HTMLElement, panel: HTMLElement) {
  const rect = box.getBoundingClientRect()
  const inset = 8
  const gap = 4
  const limit = Math.min(260, Math.max(120, window.innerHeight * 0.42))
  const below = window.innerHeight - rect.bottom - gap - inset
  const above = rect.top - gap - inset
  const up = below < Math.min(limit, 180) && above > below
  const width = Math.min(Math.max(140, rect.width), window.innerWidth - inset * 2)
  panel.style.width = `${width}px`
  panel.style.left = `${Math.min(Math.max(inset, rect.left), window.innerWidth - inset - width)}px`
  panel.style.maxHeight = `${Math.min(limit, up ? above : below)}px`
  panel.style.top = up ? 'auto' : `${rect.bottom + gap}px`
  panel.style.bottom = up ? `${window.innerHeight - rect.top + gap}px` : 'auto'
}

const icon = (path: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
)

/**
 * Seleção com painel próprio: busca sem acento, opção com subtítulo, seleção múltipla, limpar e busca remota.
 * Dentro de `Field` herda id, obrigatório, inválido e descrição.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(props, ref) {
  const {
    options, placeholder = 'Selecione', searchable = true, searchPlaceholder = 'Pesquisar', clearable, onSearchChange, onCreate,
    loading = false, loadingText = 'Carregando…', emptyText = 'Nenhuma opção encontrada',
    size = 'default', invalid, disabled, required, id, name, className,
    'aria-label': ariaLabel, 'aria-describedby': describedBy,
  } = props
  const control = useControl({ id, invalid, required, disabled, describedBy })
  const isDisabled = Boolean(control.attrs.disabled)
  const isRequired = Boolean(control.attrs.required)
  const selected = props.multiple ? props.value : props.value ? [props.value] : []

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // Na busca remota a opção escolhida pode sair da lista; o rótulo dela fica guardado para o gatilho.
  const labels = useRef(new Map<string, string>())
  for (const option of options) labels.current.set(option.value, option.label)

  const visible = useMemo(() => (onSearchChange ? options : filterOptions(options, query)), [options, query, onSearchChange])
  const optionId = (index: number) => `${listId}-option-${index}`
  // "Adicionar …" entra como último item do painel, depois das opções visíveis.
  const newLabel = query.trim()
  const canCreate = Boolean(onCreate) && !loading && newLabel !== '' && !options.some((option) => normalizeSearch(option.label) === normalizeSearch(newLabel))
  const total = visible.length + (canCreate ? 1 : 0)
  const create = () => { onCreate?.(newLabel); close(true) }

  const close = (focusTrigger: boolean) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }
  const openPanel = () => {
    if (isDisabled) return
    setQuery('')
    onSearchChange?.('')
    setActive(Math.max(0, options.findIndex((option) => selected.includes(option.value))))
    setOpen(true)
  }

  useLayoutEffect(() => {
    const box = boxRef.current
    const panel = panelRef.current
    if (!open || !box || !panel) return
    // Camada superior do navegador: fica acima de qualquer z-index, inclusive do host do Dynamics.
    try { panel.showPopover?.() } catch { /* sem suporte: o painel segue fixo, com z-index alto */ }
    placePanel(box, panel)
    if (searchable && !window.matchMedia('(pointer: coarse)').matches) searchRef.current?.focus()

    let frame = 0
    const reposition = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => placePanel(box, panel)) }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!box.contains(target) && !panel.contains(target)) setOpen(false)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('pointerdown', outside)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, searchable])

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const emit = (values: string[]) => {
    if (props.multiple) props.onChange(values)
    else props.onChange(values[0] ?? null)
  }
  const pick = (option: SelectOption | undefined) => {
    if (!option || option.disabled) return
    if (props.multiple) {
      emit(selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value])
    } else {
      emit([option.value])
      close(true)
    }
  }
  const move = (step: number, from = active) => {
    for (let index = from + step; index >= 0 && index < total; index += step) {
      if (!visible[index]?.disabled) return setActive(index)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPanel() }
      return
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); break
      case 'ArrowUp': event.preventDefault(); move(-1); break
      case 'Home': event.preventDefault(); move(1, -1); break
      case 'End': event.preventDefault(); move(-1, total); break
      case 'Enter': event.preventDefault(); if (canCreate && active === visible.length) create(); else pick(visible[active]); break
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); break
      case 'Tab': close(false); break
    }
  }

  const showClear = (clearable ?? !isRequired) && selected.length > 0 && !isDisabled
  const first = selected.length ? labels.current.get(selected[0]) ?? selected[0] : null
  const activeDescendant = open && active < total ? optionId(active) : undefined

  return (
    <div
      ref={boxRef}
      className={controlClassName('combobox', size, control.invalid, [open && 'is-open', isDisabled && 'is-disabled', className].filter(Boolean).join(' ') || undefined)}
    >
      <button
        ref={(node) => {
          triggerRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="button"
        role="combobox"
        className="bt-select__trigger"
        id={control.attrs.id}
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={searchable ? undefined : activeDescendant}
        aria-required={isRequired || undefined}
        aria-invalid={control.attrs['aria-invalid']}
        aria-describedby={control.attrs['aria-describedby']}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={onKeyDown}
      >
        <span className={first == null ? 'bt-select__value is-placeholder' : 'bt-select__value'}>{first ?? placeholder}</span>
        {selected.length > 1 ? <span className="bt-select__count">+{selected.length - 1}</span> : null}
      </button>
      {showClear ? (
        <button type="button" className="bt-select__clear" aria-label="Limpar seleção" onClick={() => { emit([]); setOpen(false); triggerRef.current?.focus() }}>
          {icon(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, 14)}
        </button>
      ) : null}
      <span className="bt-select__caret">{icon(<path d="m6 9 6 6 6-6" />)}</span>
      {name ? selected.map((value) => <input key={value} type="hidden" name={name} value={value} />) : null}

      {open ? (
        <div ref={panelRef} className="bt-select-panel" popover="manual">
          {searchable ? (
            <input
              ref={searchRef}
              type="text"
              className="bt-select-panel__search"
              placeholder={searchPlaceholder}
              aria-label="Pesquisar opção"
              aria-controls={listId}
              aria-activedescendant={activeDescendant}
              autoComplete="off"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); onSearchChange?.(event.target.value) }}
              onKeyDown={onKeyDown}
            />
          ) : null}
          {props.multiple && visible.length > 0 ? (
            <div className="bt-select-panel__actions">
              <button type="button" onClick={() => emit([...new Set([...selected, ...visible.filter((option) => !option.disabled).map((option) => option.value)])])}>Selecionar todos</button>
              <button type="button" onClick={() => emit([])}>Limpar</button>
            </div>
          ) : null}
          <div className="bt-select-panel__list" id={listId} role="listbox" aria-multiselectable={props.multiple || undefined}>
            {loading ? <p className="bt-select-panel__status" role="status">{loadingText}</p> : null}
            {!loading && total === 0 ? <p className="bt-select-panel__status">{emptyText}</p> : null}
            {!loading ? groupRuns(visible).map((run) => {
              const rows = run.options.map(({ option, index }) => {
              const isSelected = selected.includes(option.value)
              return (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  className={index === active ? 'bt-select-option is-active' : 'bt-select-option'}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(option)}
                >
                  {props.multiple ? <span className="bt-select-option__check">{isSelected ? icon(<path d="M20 6 9 17l-5-5" />, 12) : null}</span> : null}
                  {option.icon != null ? <span className="bt-select-option__icon">{option.icon}</span> : null}
                  <span className="bt-select-option__text">
                    <span className="bt-select-option__label">{option.label}</span>
                    {option.subtitle ? <span className="bt-select-option__subtitle">{option.subtitle}</span> : null}
                  </span>
                </div>
              )
              })
              if (!run.group) return rows
              const groupId = `${listId}-group-${run.options[0].index}`
              return (
                <div key={`group-${run.group}-${run.options[0].index}`} className="bt-select-group" role="group" aria-labelledby={groupId}>
                  <div className="bt-select-group__title" id={groupId}>
                    <span>{run.group}</span>
                    <span className="bt-select-group__count">{run.options.length}</span>
                  </div>
                  {rows}
                </div>
              )
            }) : null}
            {canCreate ? (
              <div
                id={optionId(visible.length)}
                role="option"
                aria-selected={false}
                className={active === visible.length ? 'bt-select-option bt-select-option--create is-active' : 'bt-select-option bt-select-option--create'}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(visible.length)}
                onClick={create}
              >
                <span className="bt-select-option__icon">{icon(<><path d="M5 12h14" /><path d="M12 5v14" /></>)}</span>
                <span className="bt-select-option__label">Adicionar “{newLabel}”</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
})
