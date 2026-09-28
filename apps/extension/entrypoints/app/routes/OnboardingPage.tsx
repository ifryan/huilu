import { useTranslation } from '@huilu/i18n'
import { Button, cn } from '@huilu/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DataFolderSection } from '@/components/DataFolderSection'
import { ProviderComparison } from '@/components/ProviderComparison'
import { ProviderSection } from '@/components/ProviderSection'
import { readinessKey, useReadiness } from '@/lib/readiness'
import { onboardedSetting } from '@/lib/settings'

const STEPS = ['onboarding.step1', 'onboarding.step2', 'onboarding.step3'] as const

/** 首次引导：① 数据文件夹 ② 转写服务 ③ 大模型服务；每一步都可以稍后再配置 */
export function OnboardingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: readiness } = useReadiness()
  const [step, setStep] = useState(0)
  const [done, setDone] = useState(false)

  const finish = async () => {
    await onboardedSetting.setValue(true)
    await queryClient.invalidateQueries({ queryKey: readinessKey })
    setDone(true)
  }
  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish())

  if (done) {
    return (
      <section className="flex max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t('onboarding.doneTitle')}</h1>
        <p className="text-muted-foreground">{t('onboarding.doneDesc')}</p>
        <div>
          <Button onClick={() => void navigate({ to: '/' })}>{t('onboarding.openHistory')}</Button>
        </div>
      </section>
    )
  }

  const stepDone = [
    readiness?.folder.permission === 'granted',
    readiness?.transcription ?? false,
    readiness?.llm ?? false,
  ]

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('onboarding.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('onboarding.intro')}</p>
      </header>

      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((key, i) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl border p-3 text-left text-sm',
                i === step ? 'border-primary bg-primary/10' : 'border-border',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
                  stepDone[i] ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground',
                )}
              >
                {stepDone[i] ? '✓' : i + 1}
              </span>
              <span>{t(key)}</span>
            </button>
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground text-xs">{t('onboarding.stepOf', { n: step + 1 })}</p>

      {step === 0 && <DataFolderSection compact />}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <ProviderSection
            kind="transcription"
            description={t('onboarding.step2Desc')}
            onSaved={next}
          />
          <ProviderComparison />
        </div>
      )}
      {step === 2 && (
        <ProviderSection kind="llm" description={t('onboarding.step3Desc')} onSaved={next} />
      )}

      <footer className="flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t('onboarding.back')}
        </Button>
        <Button variant={stepDone[step] ? 'default' : 'outline'} onClick={next}>
          {step === STEPS.length - 1
            ? t('onboarding.finish')
            : stepDone[step]
              ? t('onboarding.next')
              : t('onboarding.skip')}
        </Button>
      </footer>
    </section>
  )
}
