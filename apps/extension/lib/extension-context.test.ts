import { expect, it, vi } from 'vitest'
import {
  checkMessageError,
  onExtensionContextInvalidated,
  reportPanelError,
} from './extension-context'
it('cleans up invalidated contexts while keeping unexpected errors diagnosable', () => {
  const invalidate = vi.fn()
  const unregister = onExtensionContextInvalidated(invalidate)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  checkMessageError(new Error('Extension context invalidated.'))
  expect(invalidate).toHaveBeenCalledOnce()
  const unexpected = new Error('unexpected storage failure')
  reportPanelError(unexpected)
  expect(log).toHaveBeenCalledWith('[huilu] recording panel failed', unexpected)
  unregister()
  reportPanelError(new Error('Extension context invalidated.'))
  expect(invalidate).toHaveBeenCalledOnce()
  log.mockRestore()
})
