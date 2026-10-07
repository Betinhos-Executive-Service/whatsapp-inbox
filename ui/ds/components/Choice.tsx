import { forwardRef, useId, type ForwardedRef, type InputHTMLAttributes, type ReactNode } from 'react'

type ChoiceBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** Rótulo visível ao lado do controle. */
  label: ReactNode
  /** Linha de apoio abaixo do rótulo. */
  description?: ReactNode
}

const check = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
)

function Choice({ kind, inputRef, label, description, className, id, ...rest }: ChoiceBase & { kind: 'checkbox' | 'radio' | 'switch'; inputRef: ForwardedRef<HTMLInputElement> }) {
  const own = useId()
  const inputId = id ?? own
  const descId = description != null ? `${inputId}-desc` : undefined
  return (
    <label className={['bt-choice', `bt-choice--${kind}`, rest.disabled && 'is-disabled', className].filter(Boolean).join(' ')} htmlFor={inputId}>
      <input ref={inputRef} id={inputId} type={kind === 'switch' ? 'checkbox' : kind} role={kind === 'switch' ? 'switch' : undefined} className="bt-choice__input" aria-describedby={descId} {...rest} />
      <span className="bt-choice__control" aria-hidden="true">{kind === 'checkbox' ? check : null}</span>
      <span className="bt-choice__text">
        <span className="bt-choice__label">{label}</span>
        {description != null ? <span className="bt-choice__description" id={descId}>{description}</span> : null}
      </span>
    </label>
  )
}

/** Caixa de seleção: várias escolhas independentes. */
export const Checkbox = forwardRef<HTMLInputElement, ChoiceBase>(function Checkbox(props, ref) {
  return <Choice kind="checkbox" {...props} inputRef={ref} />
})

/** Opção de um grupo: uma escolha entre poucas, todas visíveis. Use `name` igual nas opções do grupo. */
export const Radio = forwardRef<HTMLInputElement, ChoiceBase>(function Radio(props, ref) {
  return <Choice kind="radio" {...props} inputRef={ref} />
})

/** Interruptor: liga ou desliga algo com efeito imediato, sem botão de salvar. */
export const Switch = forwardRef<HTMLInputElement, ChoiceBase>(function Switch(props, ref) {
  return <Choice kind="switch" {...props} inputRef={ref} />
})

export type ChoiceProps = ChoiceBase

/** Agrupa Radios ou Checkboxes com um rótulo de grupo (fieldset + legend). */
export function ChoiceGroup({ label, hint, error, children, inline = false }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; inline?: boolean }) {
  const id = useId()
  return (
    <fieldset className="bt-choice-group" aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined}>
      <legend className="bt-choice-group__legend">{label}</legend>
      <div className={inline ? 'bt-choice-group__items bt-choice-group__items--inline' : 'bt-choice-group__items'}>{children}</div>
      {error ? <p className="bt-choice-group__error" id={`${id}-error`} role="alert">{error}</p> : null}
      {hint != null && !error ? <p className="bt-choice-group__hint" id={`${id}-hint`}>{hint}</p> : null}
    </fieldset>
  )
}
