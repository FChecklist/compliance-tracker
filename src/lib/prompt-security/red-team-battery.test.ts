import { describe, expect, test } from "bun:test"
import { RED_TEAM_SAMPLES, runRedTeamBattery } from "./red-team-battery"

describe("runRedTeamBattery", () => {
  test("achieves a 100% pass rate against Layer 1's deterministic classifier on the full curated battery", () => {
    const report = runRedTeamBattery()
    expect(report.totalSamples).toBe(RED_TEAM_SAMPLES.length)
    expect(report.passRatePct).toBe(100)
    expect(report.findings.every((f) => f.passed)).toBe(true)
  })

  test("every attack sample category is represented", () => {
    const report = runRedTeamBattery()
    const attackCategories = new Set(
      report.findings.filter((f) => RED_TEAM_SAMPLES.find((s) => s.id === f.sampleId)?.expectDetected).map((f) => f.category)
    )
    expect(attackCategories.has("instruction_override")).toBe(true)
    expect(attackCategories.has("role_play_jailbreak")).toBe(true)
    expect(attackCategories.has("system_prompt_exfiltration")).toBe(true)
  })

  test("benign controls are not flagged as detected", () => {
    const report = runRedTeamBattery()
    const benignFindings = report.findings.filter((f) => f.garakProbeFamily === "control")
    expect(benignFindings.length).toBeGreaterThan(0)
    expect(benignFindings.every((f) => !f.detected)).toBe(true)
  })

  test("a battery containing an undetected attack sample reports a failure, not a false pass", () => {
    const report = runRedTeamBattery([
      { id: "custom-01", category: "instruction_override", garakProbeFamily: "custom", payload: "This is a completely benign sentence with no attack content.", expectDetected: true },
    ])
    expect(report.passRatePct).toBe(0)
    expect(report.findings[0].passed).toBe(false)
  })
})
