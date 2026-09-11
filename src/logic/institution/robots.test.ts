// robots.txt is read before every web_fetch. A parser that quietly allowed
// everything would be worse than no parser, so the cases here are the ones
// that decide: longest match wins, Allow beats an equally long Disallow,
// our own token beats the wildcard group, and an empty Disallow allows.

import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../../../supabase/functions/_shared/institution/robots';

const ROBOTS = `
# comment
User-agent: *
Disallow: /private/
Disallow: /tmp
Allow: /private/public-summary
Crawl-delay: 3

User-agent: PersonalOS-Institution
Disallow: /nothing-for-us/
`;

describe('parseRobots', () => {
  it('groups rules by user-agent and keeps the crawl delay', () => {
    const groups = parseRobots(ROBOTS);
    expect(groups).toHaveLength(2);
    expect(groups[0].agents).toEqual(['*']);
    expect(groups[0].disallow).toEqual(['/private/', '/tmp']);
    expect(groups[0].crawlDelaySeconds).toBe(3);
    expect(groups[1].agents).toEqual(['personalos-institution']);
  });

  it('merges consecutive user-agent lines into one group', () => {
    const groups = parseRobots('User-agent: a\nUser-agent: b\nDisallow: /x');
    expect(groups).toHaveLength(1);
    expect(groups[0].agents).toEqual(['a', 'b']);
  });
});

describe('isAllowed', () => {
  const groups = parseRobots(ROBOTS);

  it('uses our own group when one exists, ignoring the wildcard', () => {
    expect(isAllowed(groups, 'PersonalOS-Institution/1.0', '/private/anything').allowed).toBe(true);
    expect(isAllowed(groups, 'PersonalOS-Institution/1.0', '/nothing-for-us/x').allowed).toBe(false);
    expect(isAllowed(groups, 'PersonalOS-Institution/1.0', '/x').group).toBe('ours');
  });

  it('falls back to the wildcard group for an unknown agent', () => {
    expect(isAllowed(groups, 'SomeoneElse/1.0', '/private/x').allowed).toBe(false);
    expect(isAllowed(groups, 'SomeoneElse/1.0', '/open/x').allowed).toBe(true);
  });

  it('lets the longer Allow win over a shorter Disallow', () => {
    expect(isAllowed(groups, 'SomeoneElse/1.0', '/private/public-summary').allowed).toBe(true);
  });

  it('reports the rule that decided, so a refusal can be explained', () => {
    expect(isAllowed(groups, 'SomeoneElse/1.0', '/private/x').matchedRule).toBe('Disallow: /private/');
  });

  it('honours wildcards and end-anchors', () => {
    const wild = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a/*/b');
    expect(isAllowed(wild, 'x', '/reports/2024.pdf').allowed).toBe(false);
    expect(isAllowed(wild, 'x', '/reports/2024.pdf?x=1').allowed).toBe(true);
    expect(isAllowed(wild, 'x', '/a/any/b/c').allowed).toBe(false);
  });

  it('treats an empty Disallow as permission and no robots.txt as permission', () => {
    expect(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'x', '/anything').allowed).toBe(true);
    expect(isAllowed(parseRobots(''), 'x', '/anything').allowed).toBe(true);
  });

  it('carries the crawl delay out of the matched group', () => {
    expect(isAllowed(groups, 'SomeoneElse/1.0', '/x').crawlDelaySeconds).toBe(3);
  });
});
