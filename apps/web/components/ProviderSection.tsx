import { ProviderSection as SharedProviderSection } from '@huilu/app-shell/components/ProviderSection'
import type { ComponentProps } from 'react'
export function ProviderSection(props: ComponentProps<typeof SharedProviderSection>) {
  return <SharedProviderSection {...props} browserMode />
}
