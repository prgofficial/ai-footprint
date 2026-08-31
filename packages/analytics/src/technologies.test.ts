import { describe, expect, it } from 'vitest';
import { detectContexts, detectTechnologies, technologiesFromManifest } from './technologies';
import { extractThemes, fingerprint, normalizeForFingerprint, preview, wordCount } from './text';

const names = (input: Parameters<typeof detectTechnologies>[0]) =>
  detectTechnologies(input).map((t) => t.technology);

describe('technology detection', () => {
  it('finds technologies named in a prompt', () => {
    expect(names({ text: 'the NestJS controller calls postgres through drizzle' })).toEqual(
      expect.arrayContaining(['NestJS', 'PostgreSQL', 'Drizzle']),
    );
  });

  it('matches on word boundaries so short aliases do not over-fire', () => {
    expect(names({ text: 'I am going to the shop' })).not.toContain('Go');
    expect(names({ text: 'rewrite the service in golang' })).toContain('Go');
    expect(names({ text: 'the css grid layout broke' })).toContain('CSS');
  });

  it('infers from file extensions touched by tools', () => {
    expect(names({ text: 'update this', fileExtensions: ['sol'] })).toContain('Solidity');
    expect(names({ text: 'update this', fileExtensions: ['rs'] })).toContain('Rust');
  });

  it('ranks a direct mention above a project-level hint', () => {
    const matches = detectTechnologies({
      text: 'fix the react component',
      projectTechnologies: ['Vue'],
    });
    const react = matches.find((m) => m.technology === 'React');
    const vue = matches.find((m) => m.technology === 'Vue');
    expect(react?.confidence).toBeGreaterThan(vue?.confidence ?? 1);
  });

  it('returns nothing rather than guessing on unrelated prose', () => {
    expect(names({ text: 'remind me what we agreed yesterday' })).toEqual([]);
  });
});

describe('context detection', () => {
  it('derives a task area from the technologies and the wording', () => {
    const text = 'add an api endpoint that queries postgres';
    const contexts = detectContexts({ text }, detectTechnologies({ text })).map((c) => c.context);
    expect(contexts).toContain('Backend');
  });

  it('recognises smart contract work', () => {
    const text = 'audit the solidity contract for gas issues';
    const contexts = detectContexts({ text }, detectTechnologies({ text })).map((c) => c.context);
    expect(contexts).toContain('Smart Contract');
  });

  it('stays empty when there is no signal', () => {
    expect(detectContexts({ text: 'ok thanks' }, [])).toEqual([]);
  });
});

describe('manifest scanning', () => {
  it('reads a dependency list into a project technology profile', () => {
    const found = technologiesFromManifest(
      '{"dependencies":{"react":"18","@nestjs/core":"11"},"devDependencies":{"vitest":"3"}}',
    );
    expect(found).toEqual(expect.arrayContaining(['React', 'NestJS', 'Vitest']));
  });

  it('handles a manifest it does not recognise', () => {
    expect(technologiesFromManifest('some random text')).toEqual([]);
  });
});

describe('prompt normalisation', () => {
  it('collapses paths, numbers and code so the same question fingerprints the same', () => {
    const a = fingerprint('fix the error in /home/alice/app/src/main.ts line 42');
    const b = fingerprint('fix the error in /var/www/other/src/main.ts line 187');
    expect(a).toBe(b);
  });

  it('keeps genuinely different prompts apart', () => {
    expect(fingerprint('add a login page')).not.toBe(fingerprint('remove the login page'));
  });

  it('strips fenced code before comparing', () => {
    expect(normalizeForFingerprint('explain this ```const x = 1;```')).toBe('explain this');
  });

  it('measures and previews text predictably', () => {
    expect(wordCount('  one two   three ')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(preview('a'.repeat(400))).toHaveLength(220);
    expect(preview('short  text')).toBe('short text');
  });

  it('extracts recurring themes and ignores filler words', () => {
    const themes = extractThemes([
      'fix the docker deployment',
      'the docker deployment broke again',
      'docker build is slow',
      'please help me with this',
    ]).map((t) => t.term);
    expect(themes[0]).toBe('docker');
    expect(themes).not.toContain('please');
  });
});
