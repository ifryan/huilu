/** 稳定序列化后单向散列；持久化的绑定中不含原始配置或密钥。 */
export async function fingerprint(value: unknown): Promise<string> {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, item]) => [k, stable(item)]),
      )
    }
    return v
  }
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
