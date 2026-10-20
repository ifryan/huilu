import { expect, it } from 'vitest'
import { storageMode } from './capabilities'
it('falls back when folder picker or secure context is missing', () => {
  expect(storageMode({ isSecureContext: true })).toBe('browser')
  expect(storageMode({ isSecureContext: false, showDirectoryPicker() {} })).toBe('browser')
  expect(storageMode({ isSecureContext: true, showDirectoryPicker() {} })).toBe('folder')
})
