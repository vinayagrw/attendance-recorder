import FingerprintJS, { type Agent } from '@fingerprintjs/fingerprintjs'

let agent: Agent | null = null

async function getAgent() {
  if (!agent) agent = await FingerprintJS.load()
  return agent
}

export interface DeviceInfo {
  fingerprint: string
  userAgent: string
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const a = await getAgent()
  const result = await a.get()
  return {
    fingerprint: result.visitorId,
    userAgent: navigator.userAgent,
  }
}
