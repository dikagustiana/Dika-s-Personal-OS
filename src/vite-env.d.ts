/// <reference types="vite/client" />

// Injected by Vite `define` (see vite.config.ts) — short commit SHA and
// ISO timestamp of the build, shown as the sidebar build stamp.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

// The IELTS method pages under content/ielts/. @mdx-js/rollup compiles each
// one to a component whose props are the MDX component overrides, which is
// how MethodReader restyles h2/table/etc. to match the app.
declare module '*.mdx' {
  import type { ComponentType } from 'react';

  const MDXComponent: ComponentType<{
    components?: Record<string, ComponentType<Record<string, unknown>>>;
  }>;
  export default MDXComponent;
}
