import { resolveServices as sharedResolve } from '@huilu/app-shell/lib/processing'
import { browserProvider } from './providers'
export { recordingSource, resolveService } from '@huilu/app-shell/lib/processing'
export const resolveServices: typeof sharedResolve = async (...args) => {
  const services = await sharedResolve(...args)
  return {
    transcription: services.transcription.ok
      ? { ...services.transcription, provider: browserProvider(services.transcription.provider) }
      : services.transcription,
    llm: services.llm.ok
      ? { ...services.llm, provider: browserProvider(services.llm.provider) }
      : services.llm,
  }
}
