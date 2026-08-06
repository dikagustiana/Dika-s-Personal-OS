/**
 * THE DEPLOY CONFIG IS PART OF THE ROUTING, SO IT GETS A TEST.
 *
 * finishLineRoute.ts is fully tested and was always correct — and yet every
 * deep link 404'd on direct load, because the request never reached React.
 * This app is an SPA with client-side routing and the repo carried no root
 * vercel.json at all, so Vercel looked for a file at /finish-line/swimlane,
 * found none, and refused. Client-side navigation to the same route worked,
 * which is exactly what made it look like an app bug and not a config gap.
 *
 * That failure is invisible to every test in this suite: jsdom and vitest
 * never involve a static host. So the config itself is pinned here —
 * the catch-all rewrite must exist, must point at index.html, and must not
 * quietly acquire the extras (cleanUrls, trailingSlash, redirects) that
 * change URL semantics under the router's feet.
 *
 * Why a catch-all is safe: Vercel resolves the filesystem BEFORE rewrites, so
 * a real build artifact (assets/*, the public/ favicons) is served as itself
 * and never shadowed. That ordering is what makes /(.*) correct rather than
 * reckless — see the PR for the served-order proof against the built dist.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishLineHref, parseFinishLineRoute } from './finishLineRoute';

const config = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as {
  rewrites?: Array<{ source: string; destination: string }>;
  cleanUrls?: unknown;
  trailingSlash?: unknown;
  redirects?: unknown;
};

describe('vercel.json serves the SPA on direct load', () => {
  it('carries exactly one catch-all rewrite to index.html', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }]);
  });

  it('matches every route the router actually registers', () => {
    const source = new RegExp(`^${config.rewrites?.[0].source}$`);
    const routes = [
      finishLineHref({ tab: 'matrix' }),
      finishLineHref({ tab: 'swimlane' }),
      finishLineHref({ tab: 'kebutuhan-data' }),
      finishLineHref({ tab: 'swimlane', entity: 'ARBI' }),
      finishLineHref({ tab: 'swimlane', item: '634e675f-4681-4307-b831-6cad1e7d80fa' }),
    ];
    for (const href of routes) {
      // The rewrite matches on PATH only; the query rides along untouched,
      // which is what keeps ?entity= and ?item= alive through a direct load.
      const [pathname] = href.split('?');
      expect(source.test(pathname)).toBe(true);
    }
  });

  it('still routes a rewritten deep link once the SPA boots', () => {
    // The server hands back index.html; the browser URL is unchanged, so the
    // router re-parses the original path AND query. This is the half a
    // static-host test cannot see, asserted against the real parser.
    expect(
      parseFinishLineRoute('/finish-line/swimlane', '?entity=ARBI&item=634e675f-4681-4307-b831-6cad1e7d80fa'),
    ).toEqual({
      tab: 'swimlane',
      entity: 'ARBI',
      item: '634e675f-4681-4307-b831-6cad1e7d80fa',
    });
  });

  it('names no route that no longer exists — /proses was removed', () => {
    expect(JSON.stringify(config)).not.toContain('/proses');
  });

  it('adds no URL-semantics options alongside the rewrite', () => {
    // Each of these rewrites or redirects URLs before the app sees them, and
    // the router treats a trailing slash and a query as meaningful.
    expect(config.cleanUrls).toBeUndefined();
    expect(config.trailingSlash).toBeUndefined();
    expect(config.redirects).toBeUndefined();
  });
});
