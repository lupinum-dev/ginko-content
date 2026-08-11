export function assertProductionAuditClean(report) {
  const names = Object.keys(report?.vulnerabilities ?? {})
  if (names.length > 0) {
    throw new Error(`Production audit reported vulnerabilities: ${names.sort().join(', ')}.`)
  }
}
