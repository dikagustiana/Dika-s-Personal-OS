// robots.txt, read before every web_fetch (Part 2: "respect robots.txt and
// rate limits — an institution that gets itself blocked stops being able to
// work"). Pure parser: groups by User-agent, longest-match Allow/Disallow with
// '*' and '$', Crawl-delay honoured as a minimum interval. Our own token is
// matched first, then '*'. No robots.txt (404) or an unreadable one means
// allowed; a robots.txt that cannot be fetched at all (network) is reported
// by the caller as a fetch failure, never silently treated as permission.

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export interface RobotsVerdict {
  allowed: boolean;
  matchedRule: string | null;
  crawlDelaySeconds: number | null;
  group: 'ours' | 'wildcard' | 'none';
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow') current.allow.push(value);
    else if (field === 'disallow') current.disallow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelaySeconds = seconds;
    }
  }
  return groups;
}

function ruleToRegExp(rule: string): RegExp {
  const escaped = rule
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const anchored = escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped;
  return new RegExp(`^${anchored}`);
}

export function isAllowed(groups: RobotsGroup[], userAgentToken: string, path: string): RobotsVerdict {
  const token = userAgentToken.toLowerCase();
  const ours = groups.filter((group) => group.agents.some((agent) => agent !== '*' && token.startsWith(agent)));
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  const chosen = ours.length > 0 ? ours : wildcard;
  const groupKind: RobotsVerdict['group'] = ours.length > 0 ? 'ours' : wildcard.length > 0 ? 'wildcard' : 'none';
  if (chosen.length === 0) return { allowed: true, matchedRule: null, crawlDelaySeconds: null, group: groupKind };

  let best: { allowed: boolean; rule: string; length: number } | null = null;
  const consider = (rules: string[], allowed: boolean) => {
    for (const rule of rules) {
      if (rule === '') {
        if (!allowed && best === null) best = { allowed: true, rule: 'Disallow:', length: 0 };
        continue;
      }
      if (ruleToRegExp(rule).test(path)) {
        const length = rule.replace(/\*/g, '').length;
        if (!best || length > best.length || (length === best.length && allowed && !best.allowed)) {
          best = { allowed, rule: `${allowed ? 'Allow' : 'Disallow'}: ${rule}`, length };
        }
      }
    }
  };
  for (const group of chosen) {
    consider(group.disallow, false);
    consider(group.allow, true);
  }
  const crawlDelay = chosen.map((group) => group.crawlDelaySeconds).find((delay) => delay !== null) ?? null;
  const verdict = best as { allowed: boolean; rule: string; length: number } | null;
  return {
    allowed: verdict ? verdict.allowed : true,
    matchedRule: verdict ? verdict.rule : null,
    crawlDelaySeconds: crawlDelay,
    group: groupKind,
  };
}
