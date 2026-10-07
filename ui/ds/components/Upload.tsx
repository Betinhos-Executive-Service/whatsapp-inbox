import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'

export type UploadFile = { name: string; size: number; type?: string; url?: string }

export type UploadProps = {
  /** Arquivos já escolhidos (controlado). */
  files: UploadFile[]
  /** Recebe a lista nova: `[...files, ...novos]` ou a lista sem o removido. */
  onChange: (files: UploadFile[], added: File[]) => void
  /** Tipos aceitos, como no `<input accept>`: "image/*,.pdf". */
  accept?: string
  /** Tamanho máximo por arquivo, em bytes. Maiores são recusados com mensagem. */
  maxSize?: number
  /** Quantidade máxima. */
  maxFiles?: number
  /** Texto principal da área: "Arraste as evidências ou escolha os arquivos". */
  label?: ReactNode
  /** Linha de apoio: "PDF, JPG ou PNG até 10 MB". */
  hint?: ReactNode
  disabled?: boolean
  /** Rótulo acessível do campo de arquivo. */
  'aria-label'?: string
}

/** "1,2 MB", "340 KB". */
export function formatFileSize(bytes: number) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Separa o que entra do que é recusado por tamanho ou quantidade; devolve a mensagem de recusa. */
export function acceptFiles(incoming: File[], current: number, limits: { maxSize?: number; maxFiles?: number }) {
  const errors: string[] = []
  let room = limits.maxFiles != null ? Math.max(0, limits.maxFiles - current) : Infinity
  const accepted: File[] = []
  for (const file of incoming) {
    if (limits.maxSize != null && file.size > limits.maxSize) { errors.push(`${file.name} passa de ${formatFileSize(limits.maxSize)}.`); continue }
    if (room <= 0) { errors.push(`Limite de ${limits.maxFiles} arquivo(s) atingido; ${file.name} ficou de fora.`); continue }
    accepted.push(file)
    room -= 1
  }
  return { accepted, error: errors.join(' ') || null }
}

const clip = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
)

/** Área de arrastar e soltar com lista dos arquivos, limites e erro; mantém o `<input type="file">` como contrato. */
export function Upload({ files, onChange, accept, maxSize, maxFiles, label = 'Arraste os arquivos ou escolha no computador', hint, disabled = false, 'aria-label': ariaLabel = 'Escolher arquivos' }: UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  const add = (incoming: File[]) => {
    const result = acceptFiles(incoming, files.length, { maxSize, maxFiles })
    setError(result.error)
    if (result.accepted.length) onChange([...files, ...result.accepted.map((file) => ({ name: file.name, size: file.size, type: file.type }))], result.accepted)
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled) add(Array.from(event.dataTransfer.files))
  }
  const full = maxFiles != null && files.length >= maxFiles

  return (
    <div className="bt-upload">
      <div
        className={['bt-upload__zone', dragging && 'is-dragging', (disabled || full) && 'is-disabled'].filter(Boolean).join(' ')}
        onDragOver={(event) => { event.preventDefault(); if (!disabled && !full) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="bt-upload__icon">{clip}</span>
        <div className="bt-upload__text">
          <strong>{label}</strong>
          {hint != null ? <span>{hint}</span> : null}
        </div>
        <button type="button" className="bt-upload__button" disabled={disabled || full} onClick={() => inputRef.current?.click()}>Escolher arquivos</button>
        <input
          ref={inputRef}
          type="file"
          className="bt-upload__input"
          accept={accept}
          multiple={maxFiles !== 1}
          disabled={disabled || full}
          aria-label={ariaLabel}
          aria-describedby={error ? errorId : undefined}
          tabIndex={-1}
          onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = '' }}
        />
      </div>
      {error ? <p className="bt-upload__error" id={errorId} role="alert">{error}</p> : null}
      {files.length ? (
        <ul className="bt-upload__list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="bt-upload__item">
              <span className="bt-upload__name">{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.name}</a> : file.name}</span>
              <span className="bt-upload__size">{formatFileSize(file.size)}</span>
              {!disabled ? (
                <button type="button" className="bt-upload__remove" aria-label={`Remover ${file.name}`} onClick={() => { setError(null); onChange(files.filter((_, i) => i !== index), []) }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {maxFiles != null ? <p className="bt-upload__count">{files.length} de {maxFiles}</p> : null}
    </div>
  )
}
