/** 服务商预设：选中后自动填入 Base URL、模型等字段，用户仍可修改 */
export interface ProviderPreset {
  id: string
  /** 预设名称的 i18n key */
  nameKey: string
  values: Record<string, string>
  /** 额外说明的 i18n key，例如 Ollama 需要设置 OLLAMA_ORIGINS */
  hintKey?: string
}

export interface WithPresets {
  presets: ProviderPreset[]
}

/** 取服务商的预设（没有预设的服务商返回空数组） */
export function getPresets(provider: object): ProviderPreset[] {
  return (provider as Partial<WithPresets>).presets ?? []
}
