/** IPL request types resolved through the original manager dispatch table
 * 0x81638DB8 and vtable 0x816680A8. These are not the manager's internal enum.
 */
export function keyboardProfile(nativeType) {
  const numeric = nativeType === 3 || nativeType === 10 || nativeType === 12;
  const settings = nativeType !== undefined;
  return {
    numeric,
    dotted: nativeType === 10,
    prediction: !settings || nativeType === 13,
    languages: !settings || nativeType === 13,
    symbols: !settings || nativeType === 5 || nativeType === 11 || nativeType === 13,
    layouts: !numeric && nativeType !== 7,
    bigText: numeric || nativeType === 6 || nativeType === 11,
    separators: nativeType === 12,
    multiline: !settings,
  };
}
