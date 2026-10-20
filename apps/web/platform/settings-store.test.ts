import { expect, it, vi } from 'vitest'
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {})
  vi.stubGlobal('window', new EventTarget())
})
import { createSettingsStore } from './settings-store'
function setup() {
  const data = new Map<string, string>()
  const target = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  } as Storage
  return { data, target, store: createSettingsStore(target, new EventTarget()) }
}
it('roundtrips local configuration and notifies/unsubscribes same-page consumers', async () => {
  const { store, data } = setup()
  const item = store.defineItem('local:llm', { fallback: { key: '' } })
  const listener = vi.fn()
  const unwatch = item.watch(listener)
  expect(await item.getValue()).toEqual({ key: '' })
  await item.setValue({ key: 'local-key' })
  expect(await item.getValue()).toEqual({ key: 'local-key' })
  expect(listener).toHaveBeenCalledOnce()
  unwatch()
  await item.setValue({ key: 'new' })
  expect(listener).toHaveBeenCalledOnce()
  expect([...data.keys()]).toEqual(['huilu:local:llm'])
})
it('recovers malformed JSON and surfaces quota/storage failures', async () => {
  const { store, data, target } = setup()
  data.set('huilu:x', '{')
  const item = store.defineItem('x', { fallback: 123 })
  expect(await item.getValue()).toBe(123)
  target.setItem = () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  await expect(item.setValue(2)).rejects.toThrow('quota')
})
