/// <reference types="vite/client" />

declare module 'virtual:content/*' {
  import type { UnifiedDoc } from '@crispice/universal-content';
  const content: UnifiedDoc[] | UnifiedDoc | null;
  export default content;
}

declare module 'virtual:md-content/*' {
  import type { UnifiedDoc } from '@crispice/universal-content';
  const content: UnifiedDoc[] | UnifiedDoc | null;
  export default content;
}