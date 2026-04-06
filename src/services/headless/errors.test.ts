import { describe, expect, it } from 'bun:test'
import {
  getHeadlessProviderExecutionErrorCode,
  getHeadlessProviderInvalidInputCode,
  getHeadlessProviderUnsupportedCapabilityCode,
  getHeadlessProviderUnsupportedModeCode,
} from './errors.js'

describe('headless provider error codes', () => {
  it('builds stable prefixed error codes', () => {
    expect(getHeadlessProviderUnsupportedModeCode()).toBe(
      'HEADLESS_PROVIDER_UNSUPPORTED_MODE',
    )
    expect(getHeadlessProviderUnsupportedCapabilityCode()).toBe(
      'HEADLESS_PROVIDER_UNSUPPORTED_CAPABILITY',
    )
    expect(getHeadlessProviderInvalidInputCode()).toBe(
      'HEADLESS_PROVIDER_INVALID_INPUT',
    )
    expect(getHeadlessProviderExecutionErrorCode()).toBe(
      'HEADLESS_PROVIDER_EXECUTION_ERROR',
    )
  })
})
