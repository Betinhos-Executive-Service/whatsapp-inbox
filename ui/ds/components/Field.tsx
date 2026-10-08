import {
  createContext, forwardRef, useContext, useId,
  type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react'

export type ControlSize = 'compact' | 'default' | 'touch'

type FieldState = { controlId: string; describedBy?: string; invalid: boolean; required: boolean; disabled: boolean }
const FieldContext = createContext<FieldState | null>(null)

/** Ids do campo e a lista de `aria-describedby`, na ordem em que o leitor de tela deve ler: erro, depois ajuda. */
export function fieldIds(base: string, parts: { hint?: boolean; error?: boolean }) {
  const hintId = parts.hint ? `${base}-hint` : undefined
  const errorId = parts.error ? `${base}-error` : undefined
  return { controlId: `${base}-control`, hintId, errorId, describedBy: [errorId, hintId].filter(Boolean).join(' ') || undefined }
}

export type FieldProps = {
  /** Rótulo visível, sempre acima do controle. Placeholder não substitui rótulo. */
  label: ReactNode
  /** Ajuda permanente abaixo do controle. */
  hint?: ReactNode
  /** Mensagem de erro: o que aconteceu e como resolver. Marca o controle como inválido. */
  error?: ReactNode
  /** Mostra o asterisco e marca o controle como obrigatório. */
  required?: boolean
  /** Desabilita o controle e esmaece o rótulo. */
  disabled?: boolean
  className?: string
  /** Um controle: `Input`, `Textarea` ou `Select`. */
  children: ReactNode
}

/** Rótulo, controle, ajuda e erro ligados por id; o controle filho recebe `aria-invalid` e `aria-describedby` sozinho. */
export function Field({ label, hint, error, required = false, disabled = false, className, children }: FieldProps) {
  const hasError = error != null && error !== false && error !== ''
  const ids = fieldIds(useId(), { hint: hint != null, error: hasError })
  return (
    <FieldContext.Provider value={{ controlId: ids.controlId, describedBy: ids.describedBy, invalid: hasError, required, disabled }}>
      <div className={['bt-field', disabled && 'bt-field--disabled', className].filter(Boolean).join(' ')}>
        <label className="bt-field__label" htmlFor={ids.controlId}>
          {label}
          {required ? <span className="bt-field__required" aria-hidden="true"> *</span> : null}
        </label>
        {children}
        {hasError ? (
          <p className="bt-field__error" id={ids.errorId} role="alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />
            </svg>
            <span>{error}</span>
          </p>
        ) : null}
        {hint != null ? <p className="bt-field__hint" id={ids.hintId}>{hint}</p> : null}
      </div>
    </FieldContext.Provider>
  )
}

type ControlStyle = { size?: ControlSize; invalid?: boolean }

/** Atributos que o controle herda do `Field` em volta; o que for passado direto no controle tem prioridade. */
export function useControl(own: { id?: string; invalid?: boolean; required?: boolean; disabled?: boolean; describedBy?: string }) {
  const field = useContext(FieldContext)
  const invalid = own.invalid ?? field?.invalid ?? false
  return {
    invalid,
    attrs: {
      id: own.id ?? field?.controlId,
      required: own.required ?? (field?.required || undefined),
      disabled: own.disabled ?? (field?.disabled || undefined),
      'aria-invalid': invalid || undefined,
      'aria-describedby': own.describedBy ?? field?.describedBy,
    },
  }
}

export function controlClassName(kind: string, size: ControlSize, invalid: boolean, className?: string) {
  return ['bt-control', `bt-control--${kind}`, size !== 'default' && `bt-control--${size}`, invalid && 'bt-control--invalid', className].filter(Boolean).join(' ')
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & ControlStyle & {
  /** Conteúdo fixo antes do valor: ícone ou unidade ("R$"). */
  prefix?: ReactNode
  /** Conteúdo fixo depois do valor: ícone ou unidade ("km"). */
  suffix?: ReactNode
}

/** Campo de uma linha. Dentro de `Field` herda id, obrigatório, inválido e descrição. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'default', invalid, prefix, suffix, className, id, required, disabled, 'aria-describedby': describedBy, type = 'text', ...rest },
  ref,
) {
  const control = useControl({ id, invalid, required, disabled, describedBy })
  return (
    <div className={controlClassName('input', size, control.invalid, className)}>
      {prefix != null ? <span className="bt-control__affix">{prefix}</span> : null}
      <input ref={ref} type={type} className="bt-control__input" {...control.attrs} {...rest} />
      {suffix != null ? <span className="bt-control__affix">{suffix}</span> : null}
    </div>
  )
})

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }

/** Texto de várias linhas, redimensionável na vertical. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, id, required, disabled, 'aria-describedby': describedBy, rows = 3, ...rest },
  ref,
) {
  const control = useControl({ id, invalid, required, disabled, describedBy })
  return (
    <div className={controlClassName('textarea', 'default', control.invalid, className)}>
      <textarea ref={ref} rows={rows} className="bt-control__input" {...control.attrs} {...rest} />
    </div>
  )
})
