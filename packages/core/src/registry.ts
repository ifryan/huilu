/** 扩展点的通用注册中心：各实现模块调用 register 登记，界面根据 list() 自动生成选项 */
export interface Registrable {
  readonly id: string
}

export class Registry<T extends Registrable> {
  readonly #items = new Map<string, T>()

  constructor(readonly kind: string) {}

  register(item: T): void {
    if (this.#items.has(item.id)) {
      throw new Error(`${this.kind} "${item.id}" 已注册`)
    }
    this.#items.set(item.id, item)
  }

  get(id: string): T {
    const item = this.#items.get(id)
    if (!item) throw new Error(`未找到 ${this.kind} "${id}"`)
    return item
  }

  has(id: string): boolean {
    return this.#items.has(id)
  }

  list(): T[] {
    return [...this.#items.values()]
  }
}
