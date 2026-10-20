import { CHARACTER_ORDER } from '../config/app.config.ts';

export interface TierMeterSnapshot {
  t0Steps: number;
  t1Narrations: number;
  t2Calls: number;
  worldMinutesSimulated: number;
  worldHoursSimulated: number;
  baselineCalls: number;
  savingsRatio: number;
  latencySamplesMs: number[];
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class TierMeter {
  private t0Steps = 0;
  private t1Narrations = 0;
  private t2Calls = 0;
  private worldMinutesSimulated = 0;
  private latencySamplesMs: number[] = [];
  private inputTokens = 0;
  private outputTokens = 0;

  public recordT0Step(minutesAdvanced = 15): void {
    this.t0Steps += 1;
    this.worldMinutesSimulated += Math.max(0, minutesAdvanced);
  }

  public recordT1Narration(): void {
    this.t1Narrations += 1;
  }

  public recordT2Call(latencyMs: number, usage?: { inputTokens: number; outputTokens: number }): void {
    this.t2Calls += 1;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.latencySamplesMs.push(Math.round(latencyMs));
      if (this.latencySamplesMs.length > 30) {
        this.latencySamplesMs.shift();
      }
    }
    if (usage) {
      this.inputTokens += Math.max(0, usage.inputTokens || 0);
      this.outputTokens += Math.max(0, usage.outputTokens || 0);
    }
  }

  public getBaselineCalls(): number {
    const charactersCount = CHARACTER_ORDER.length;
    const worldHours = Math.max(1, this.worldMinutesSimulated / 60);
    return Math.round(charactersCount * worldHours);
  }

  /**
   * 1 - t2Calls / max(1, baselineCalls)
   */
  public savings(): number {
    const baseline = Math.max(1, this.getBaselineCalls());
    const ratio = 1 - this.t2Calls / baseline;
    return Math.max(0, Math.min(1, Number(ratio.toFixed(4))));
  }

  public snapshot(): TierMeterSnapshot {
    const avgLatencyMs =
      this.latencySamplesMs.length > 0
        ? Math.round(
            this.latencySamplesMs.reduce((acc, v) => acc + v, 0) /
              this.latencySamplesMs.length
          )
        : 0;
    const worldHoursSimulated = Number((this.worldMinutesSimulated / 60).toFixed(1));
    return {
      t0Steps: this.t0Steps,
      t1Narrations: this.t1Narrations,
      t2Calls: this.t2Calls,
      worldMinutesSimulated: this.worldMinutesSimulated,
      worldHoursSimulated,
      baselineCalls: this.getBaselineCalls(),
      savingsRatio: this.savings(),
      latencySamplesMs: [...this.latencySamplesMs],
      avgLatencyMs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }

  public reset(): void {
    this.t0Steps = 0;
    this.t1Narrations = 0;
    this.t2Calls = 0;
    this.worldMinutesSimulated = 0;
    this.latencySamplesMs = [];
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}

export const globalTierMeter = new TierMeter();
