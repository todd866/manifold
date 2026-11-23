import { ManifoldConsole } from '@/components/ManifoldConsole';
import { getManifoldHub } from '@/lib/engine';
import { MANIFOLD_MCP_TOOLS } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const hub = getManifoldHub();
  const works = hub.listWorks({ limit: 200 });
  const lenses = hub.listLenses();
  const contributors = hub.listContributors();
  const mcpTools = MANIFOLD_MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  return (
    <ManifoldConsole
      works={works}
      lenses={lenses}
      contributors={contributors}
      mcpTools={mcpTools}
    />
  );
}
