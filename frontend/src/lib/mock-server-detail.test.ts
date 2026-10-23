import { afterEach, describe, expect, it, vi } from "vitest"

async function completeRequest<T>(request: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(300)
  return request
}

afterEach(() => vi.useRealTimers())

describe("mock key renewal", () => {
  it("keeps repeated 30-day renewals at 30 days from the latest renewal", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"))
    vi.resetModules()
    const { mockServerDetail, mockExtendKey } =
      await import("./mock-server-detail")
    const initial = await completeRequest(mockServerDetail())
    const keyId = initial.keys[0].id

    for (let renewal = 0; renewal < 3; renewal++) {
      vi.setSystemTime(new Date("2026-10-23T12:00:00Z"))
      await completeRequest(mockExtendKey(keyId, 200, 30))
      const detail = await completeRequest(mockServerDetail())
      const key = detail.keys.find((item) => item.id === keyId)
      expect(key?.daysLeft).toBe(30)
      expect(key?.endDate).toBe("2026-11-22T12:00:00.000Z")
    }

    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"))
    await completeRequest(mockExtendKey(keyId, 200, 30))
    const detail = await completeRequest(mockServerDetail())
    expect(detail.keys.find((item) => item.id === keyId)?.endDate).toBe(
      "2026-11-27T12:00:00.000Z"
    )
  })
})
