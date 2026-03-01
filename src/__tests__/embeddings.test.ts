import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('handles zero vectors', () => {
    const zero = [0, 0, 0];
    const v = [1, 2, 3];
    expect(cosineSimilarity(zero, v)).toBe(0);
  });

  it('handles different lengths', () => {
    const a = [1, 2];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('computes known similarity', () => {
    const a = [1, 0];
    const b = [1, 1];
    // cos(45°) ≈ 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.7071, 3);
  });
});
