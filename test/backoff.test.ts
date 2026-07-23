import { describe, it, expect } from "vitest";
import {
    backoffDelay,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS,
} from "../src/util/backoff.js";

// random() = 0 → không trừ jitter (trần trên); random() = 1 → trừ tối đa (sàn dưới).
const noJitter = (): number => 0;
const fullJitter = (): number => 1;

describe("backoffDelay", () => {
    it("returns the base delay on the first attempt", () => {
        expect(backoffDelay(1, { random: noJitter })).toBe(BACKOFF_BASE_MS);
    });

    it("doubles the delay on each consecutive attempt", () => {
        expect(backoffDelay(2, { random: noJitter })).toBe(2_000);
        expect(backoffDelay(3, { random: noJitter })).toBe(4_000);
        expect(backoffDelay(4, { random: noJitter })).toBe(8_000);
        expect(backoffDelay(5, { random: noJitter })).toBe(16_000);
    });

    it("caps the delay at BACKOFF_MAX_MS", () => {
        expect(backoffDelay(6, { random: noJitter })).toBe(BACKOFF_MAX_MS);
        expect(backoffDelay(50, { random: noJitter })).toBe(BACKOFF_MAX_MS);
    });

    it("subtracts at most the jitter ratio, never adds", () => {
        expect(backoffDelay(1, { random: fullJitter })).toBe(800);
        expect(backoffDelay(3, { random: fullJitter })).toBe(3_200);
    });

    it("stays within (0, BACKOFF_MAX_MS] for every attempt with real randomness", () => {
        for (let attempt = 1; attempt <= 50; attempt += 1) {
            const delay = backoffDelay(attempt);

            expect(delay).toBeGreaterThan(0);
            expect(delay).toBeLessThanOrEqual(BACKOFF_MAX_MS);
        }
    });

    it("treats attempt 0 and negative attempts as the first attempt", () => {
        expect(backoffDelay(0, { random: noJitter })).toBe(BACKOFF_BASE_MS);
        expect(backoffDelay(-5, { random: noJitter })).toBe(BACKOFF_BASE_MS);
    });

    it("returns whole milliseconds", () => {
        expect(Number.isInteger(backoffDelay(3, { random: () => 0.137 }))).toBe(
            true,
        );
    });
});
