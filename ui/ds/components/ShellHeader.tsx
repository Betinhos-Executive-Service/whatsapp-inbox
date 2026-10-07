import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'

/** O que uma tela pede ao cabeçalho do celular: título próprio e ações (em geral só atualizar). */
export type ShellHeaderEntry = { title?: string; actions?: ReactNode }

export type ShellHeaderStore = {
  get: () => ShellHeaderEntry | null
  /** Registra a tela; devolve a função que remove só este registro. */
  register: (entry: ShellHeaderEntry) => () => void
  subscribe: (listener: () => void) => () => void
}

/** Guarda o registro da tela atual; o mais recente vence e sair limpa só o próprio registro. */
export function createShellHeaderStore(): ShellHeaderStore {
  let current: { token: symbol; entry: ShellHeaderEntry } | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    get: () => current?.entry ?? null,
    register(entry) {
      const token = Symbol('shell-header')
      current = { token, entry }
      emit()
      return () => {
        if (current?.token !== token) return
        current = null
        emit()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const ShellHeaderContext = createContext<ShellHeaderStore | null>(null)

/** Cria o store uma vez por AppShell. */
export function useShellHeaderStore() {
  const [store] = useState(createShellHeaderStore)
  return store
}

/** Lê o registro atual; `null` quando a tela não usa `useShellHeader`. */
export function useShellHeaderEntry(store: ShellHeaderStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/**
 * Uma rota React dentro do AppShell define o título e as ações do cabeçalho do celular.
 * No desktop não há cabeçalho de shell: as ações da tela ficam no `PageHeader`. Fora do AppShell não faz nada.
 */
export function useShellHeader({ title, actions }: ShellHeaderEntry) {
  const store = useContext(ShellHeaderContext)
  useEffect(() => store?.register({ title, actions }), [store, title, actions])
}
