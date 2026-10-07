import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'action' | 'ghost' | 'danger'
export type ButtonSize = 'compact' | 'default' | 'touch'

type ButtonStyle = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; iconOnly?: boolean }

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: tarefa principal (uma por bloco). secondary: alternativa. action: ação contextual. ghost: terciária. danger: destrutiva. */
  variant?: ButtonVariant
  /** compact 32px, default 40px, touch 44px. Em ponteiro grosso, default sobe para 44px sozinho. */
  size?: ButtonSize
  /** Ícone antes do rótulo. Sem `children`, o botão vira quadrado e exige `aria-label`. */
  icon?: ReactNode
  /** Ícone depois do rótulo. */
  iconEnd?: ReactNode
  /** Bloqueia o clique, marca `aria-busy` e troca o ícone pelo indicador, sem mudar a largura. */
  loading?: boolean
  /** Ocupa toda a largura do contêiner. */
  fullWidth?: boolean
}

/** Classes do botão, para aplicar o mesmo visual em `<a>` ou em outro elemento. */
export function buttonClassName({ variant = 'primary', size = 'default', fullWidth, iconOnly }: ButtonStyle = {}, extra?: string) {
  return [
    'bt-button',
    `bt-button--${variant}`,
    size !== 'default' && `bt-button--${size}`,
    fullWidth && 'bt-button--full',
    iconOnly && 'bt-button--icon',
    extra,
  ].filter(Boolean).join(' ')
}

const spinner = (
  <svg className="bt-button__spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

/** Botão de ação. `type` é `button` por padrão, para não enviar formulários por acidente. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, iconEnd, loading = false, fullWidth, className, disabled, type = 'button', children, ...rest },
  ref,
) {
  const iconOnly = children == null || children === false
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName({ variant, size, fullWidth, iconOnly }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? spinner : icon}
      {iconOnly ? null : <span className="bt-button__label">{children}</span>}
      {iconEnd}
    </button>
  )
})
