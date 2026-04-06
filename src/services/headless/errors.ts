import {
  HEADLESS_PROVIDER_ERROR_PREFIX,
  type HeadlessProviderErrorCode,
} from './provider.js'

function buildHeadlessProviderErrorCode(
  suffix: 'UNSUPPORTED_MODE' | 'UNSUPPORTED_CAPABILITY' | 'INVALID_INPUT' | 'EXECUTION_ERROR',
): HeadlessProviderErrorCode {
  return `${HEADLESS_PROVIDER_ERROR_PREFIX}_${suffix}`
}

export function getHeadlessProviderUnsupportedModeCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('UNSUPPORTED_MODE')
}

export function getHeadlessProviderUnsupportedCapabilityCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('UNSUPPORTED_CAPABILITY')
}

export function getHeadlessProviderInvalidInputCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('INVALID_INPUT')
}

export function getHeadlessProviderExecutionErrorCode(): HeadlessProviderErrorCode {
  return buildHeadlessProviderErrorCode('EXECUTION_ERROR')
}
