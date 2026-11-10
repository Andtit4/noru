export enum UnusedEnum {
  Value = 'UNUSED_MARKER_ENUM',
}
const makeThing = (label: string) => ({ label })
export const unusedPureCall = /* @__PURE__ */ makeThing('UNUSED_MARKER_PURE_CALL')
