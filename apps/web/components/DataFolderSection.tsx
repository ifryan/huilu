import { DataFolderSection as SharedDataFolderSection } from '@huilu/app-shell/components/DataFolderSection'
import { useTranslation } from '@huilu/i18n'
import { Button } from '@huilu/ui'
import { useState } from 'react'
import { Section } from '@huilu/app-shell/components/Section'
import { localResults, requestPersistence } from '@/platform/capabilities'
export function DataFolderSection(props: { compact?: boolean }) {
  const { t } = useTranslation()
  const [persisted, setPersisted] = useState<boolean>()
  if (!localResults) return <SharedDataFolderSection {...props} />
  return (
    <Section title={t('web.browserStorage')}>
      <p className="bg-warning-soft rounded-control text-body p-3" role="status">
        {t('web.storageWarning')}
      </p>
      <Button variant="outline" onClick={() => void requestPersistence().then(setPersisted)}>
        {t('web.persist')}
      </Button>
      {persisted !== undefined && (
        <p role="status">{t(persisted ? 'web.persistYes' : 'web.persistNo')}</p>
      )}
    </Section>
  )
}
