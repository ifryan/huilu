export interface Setting<T> {
  getValue(): Promise<T>
  setValue(value: T): Promise<void>
  watch(callback: (value: T) => void): () => void
}

/** Keys stay on this origin, never in the user's data folder. Write failures are surfaced. */
export function createSettingsStore(target: Storage, events: EventTarget) {
  return {
    defineItem<T>(name: string, { fallback }: { fallback: T }): Setting<T> {
      const key = `huilu:${name}`
      const read = (): T => {
        const raw = target.getItem(key)
        if (raw === null) return structuredClone(fallback)
        try {
          return JSON.parse(raw) as T
        } catch {
          return structuredClone(fallback)
        }
      }
      return {
        async getValue() {
          return read()
        },
        async setValue(value) {
          target.setItem(key, JSON.stringify(value))
          events.dispatchEvent(new CustomEvent(key, { detail: value }))
        },
        watch(callback) {
          const own = () => callback(read())
          const other = (e: Event) => {
            const event = e as StorageEvent
            if (event.storageArea === target && (event.key === key || event.key === null)) own()
          }
          events.addEventListener(key, own)
          events.addEventListener('storage', other)
          return () => {
            events.removeEventListener(key, own)
            events.removeEventListener('storage', other)
          }
        },
      }
    },
  }
}
export const storage = createSettingsStore(localStorage, window)
