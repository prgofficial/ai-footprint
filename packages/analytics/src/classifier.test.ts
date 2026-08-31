import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeuristicClassifier } from './classifier';
import type { PromptCategory } from '@ai-footprint/shared';

interface Labelled {
  text: string;
  expected: PromptCategory;
}

const FIXTURES = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'labelled-prompts.json'), 'utf8'),
) as Labelled[];

/** Raising this number is a deliberate act. Lowering it means the classifier regressed. */
const MINIMUM_ACCURACY = 0.9;

const classifier = new HeuristicClassifier();

describe('heuristic classifier', () => {
  it('has a fixture set large enough to be meaningful', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(150);
  });

  it('meets the accuracy floor on the labelled set', () => {
    const misses: string[] = [];
    let correct = 0;

    for (const sample of FIXTURES) {
      const result = classifier.classify({ text: sample.text });
      if (result.category === sample.expected) correct += 1;
      else misses.push(`${sample.expected} -> ${result.category}: "${sample.text}"`);
    }

    const accuracy = correct / FIXTURES.length;
    expect(accuracy, `misses (${misses.length}):\n${misses.join('\n')}`).toBeGreaterThanOrEqual(
      MINIMUM_ACCURACY,
    );
  });

  it('answers Other with low confidence rather than guessing on thin input', () => {
    for (const text of ['ok', 'continue', 'thanks', 'hmm']) {
      const result = classifier.classify({ text });
      expect(result.category, text).toBe('Other');
      expect(result.confidence, text).toBeLessThan(0.4);
    }
  });

  it('uses the tools of the following turn to break a tie', () => {
    const ambiguous = 'handle the user record';
    const withEdits = classifier.classify({
      text: ambiguous,
      toolNames: ['Edit', 'Write', 'Edit'],
    });
    const withReads = classifier.classify({ text: ambiguous, toolNames: ['Read', 'Grep', 'Read'] });
    expect(withEdits.category).toBe('Implementation');
    expect(withReads.category).toBe('Research');
  });

  it('is deterministic', () => {
    const first = classifier.classify({ text: 'refactor the payment service' });
    const second = classifier.classify({ text: 'refactor the payment service' });
    expect(first).toEqual(second);
  });

  it('reports a version so stored results can be reprocessed selectively', () => {
    expect(classifier.classify({ text: 'fix the bug' }).version).toBeGreaterThan(0);
  });

  it('returns a confidence between 0 and 1 for every fixture', () => {
    for (const sample of FIXTURES) {
      const { confidence } = classifier.classify({ text: sample.text });
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it('never throws on hostile input', () => {
    for (const text of ['', '   ', 'a'.repeat(50_000)]) {
      expect(() => classifier.classify({ text })).not.toThrow();
    }
  });
});
