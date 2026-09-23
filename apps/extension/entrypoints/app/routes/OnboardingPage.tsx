import { useTranslation } from '@huilu/i18n'

export function OnboardingPage() {
  const { t } = useTranslation()
  const steps = ['onboarding.step1', 'onboarding.step2', 'onboarding.step3'] as const

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('nav.onboarding')}</h1>
      <ol className="flex flex-col gap-3">
        {steps.map((key, i) => (
          <li key={key} className="bg-muted flex items-center gap-3 rounded-xl p-4">
            <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full text-sm">
              {i + 1}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
