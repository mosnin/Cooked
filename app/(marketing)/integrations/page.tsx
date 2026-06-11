/**
 * `/integrations` — every app Chippi can work inside, through Composio.
 *
 * One idea: connect the tools you already pay for, and Chippi calls each one
 * as a tool while it works — pulling data out of your workflows and writing
 * results back where they belong.
 *
 * The catalog is rendered straight from `lib/integrations/catalog.ts` (the
 * source of truth). We don't invent integrations or blurbs here; the page is
 * a faithful surface over that data. Bespoke body lives in
 * `components/marketing/integrations/integrations-page.tsx` because it needs
 * the home-kit motion + AsciiBlob atmosphere (client).
 */

import { IntegrationsPage } from '@/components/marketing/integrations/integrations-page';

export const metadata = {
  title: 'Integrations · Chippi',
  description:
    'Connect the tools you already use. Chippi connects through Composio, then calls each one as a tool while it works, pulling data from and pushing data into your existing workflows.',
};

export default function Page() {
  return <IntegrationsPage />;
}
