import { formatName } from './format'
export function usedHelper(name: string) {
  return 'hello ' + formatName(name)
}
export function unusedHelperA() {
  return 'UNUSED_MARKER_A'
}
function unusedLocal() {
  return 'UNUSED_MARKER_LOCAL'
}
export const unusedConstant = { label: 'UNUSED_MARKER_CONST', run: unusedLocal }
