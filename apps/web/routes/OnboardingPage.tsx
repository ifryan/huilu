import { OnboardingPage as SharedOnboardingPage } from '@huilu/app-shell/routes/OnboardingPage'
import { MicrophonePermission } from '@/components/MicrophonePermission'
export function OnboardingPage() {
  return (
    <div className="flex flex-col gap-8">
      <SharedOnboardingPage />
      <MicrophonePermission />
    </div>
  )
}
