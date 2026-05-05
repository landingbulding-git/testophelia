// Ophelia MCP Gateway — Cloudflare Worker
// POST /call  {platform, tool, input}  → tool result (cached 15min in KV)
// POST /list  {platform}               → available tools for platform
// POST /auth  {platform, code}         → OAuth stub (future)

const PLATFORM_KB = {
  'bubble.io': {
    description: 'No-code visual web app builder with designer, database, and workflow engine.',
    docs: {
      editor: `Bubble editor tabs (left sidebar): Design (UI elements), Workflow (automation logic), Data (database types/fields), Styles, Plugins, Settings.\nTop bar: Preview, Publish, breakpoint switcher.`,
      design: `UI Elements: Section, Group, Repeating Group, Popup (layout); Text, Image, Icon (display); Input, Multiline Input, Dropdown, Checkbox, File Uploader (inputs); Button, Link (actions).\nAdd element: drag from left panel or double-click canvas. Make dynamic: click element → "Insert dynamic data".`,
      workflow: `Workflow tab — Triggers: "When Button is clicked", "When page is loaded", "When input value changed", "When condition is true".\nActions: Navigate to page, Show/Hide element, Create a new [Type], Make changes to [Type], Delete [Type], Log the user in/out, Create an account, Run an API.\nAdd action: click trigger → "+ Add an action" → choose category → configure.`,
      database: `Data tab — Type = table, Field = column, Record = row.\nField types: text, number, date, boolean, image, file, geographic address, option set, list, relation (link to another type).\nCreate type: Data → New Type → add fields.\nQuery: "Do a search for [Type]" with Constraints to filter. "Current User" is always available when logged in.`,
      auth: `Login: Workflow action "Log the user in" (email + password). Signup: "Create an account" action. Check login status: condition "Current User is logged in".\nPrivacy rules: Data tab → Privacy → control read/find/edit per type and per field.`,
    }
  },
  'zoho.com': {
    description: 'Enterprise CRM for managing leads, contacts, deals, and automation.',
    docs: {
      navigation: `Main modules (left sidebar): Leads, Contacts, Accounts, Deals, Activities, Campaigns, Reports, Dashboards, Products.\nGlobal search: magnifier icon at top.`,
      leads: `Create lead: Leads → "+ Lead" → fill Name, Company, Email, Phone → Save.\nLead status: New → Assigned → In Process → Converted → Recycled → Dead.\nConvert: open lead → "Convert" button → creates Contact + Account + Deal.\nCustom fields: Setup → Modules and Fields → Leads → + New Field.`,
      deals: `Default stages: Qualification → Value Proposition → Id. Decision Makers → Perception Analysis → Proposal/Price Quote → Negotiation/Review → Closed Won/Lost.\nView pipeline: Deals → Kanban view. Create deal: "+ Deal" → set Name, Amount, Close Date, Stage, Account.\nUpdate stage: open deal → click Stage field OR drag card in Kanban.`,
      automation: `Workflow Rules (Setup → Automation → Workflow Rules): trigger on record create/update/date → add conditions → add actions (email, field update, task, webhook).\nBlueprints: visual step-by-step process, enforces required stages and data.\nMacros: multi-action shortcuts applied manually or via workflow.`,
    }
  },
  'notion.com': {
    description: 'Collaborative workspace with pages, databases, and AI writing tools.',
    docs: {
      blocks: `Type "/" to open block menu. Common blocks: /text, /h1 /h2 /h3, /callout, /todo, /toggle, /table, /board, /code, /image.\nMove block: drag ⠿ handle on left. Convert: select text → click type in toolbar.`,
      databases: `Create: type /table (or /board /gallery /calendar /list /timeline).\nProperty types: Title, Text, Number, Select, Multi-select, Status, Date, Person, Checkbox, URL, Formula, Relation, Rollup.\nFilter: "Filter" button → add condition. Sort: "Sort" button. Group: "..." → Group by (Select/Status).`,
      ai: `Notion AI: select text → "Ask AI" OR type /ai for AI block.\nCommands: Summarize, Improve writing, Make shorter/longer, Continue writing, Find action items, Translate, Explain.`,
    }
  },
  'suno.com': {
    description: 'AI music generation platform — create full songs from text prompts.',
    docs: {
      creating: `Create song: "+ Create" → Simple mode (one prompt) or Custom mode (Lyrics + Style of Music + Title). Instrumental toggle = no vocals. Click Create → 2 versions generated (~20s, costs 5 credits each).`,
      style_prompting: `Style of Music field examples: "cinematic orchestral, epic strings, emotional", "lo-fi hip hop, chill, 75bpm", "heavy metal, fast guitar, aggressive", "bossa nova, acoustic guitar, female vocals".\nBe specific: genre + mood + instruments + tempo + artist reference ("like Nirvana").`,
      lyrics: `Structure tags (own line): [Intro] [Verse] [Chorus] [Pre-Chorus] [Bridge] [Outro] [End] [Guitar Solo] [Instrumental Break] [Spoken Word].\nTips: short lines (6-10 words), use [End] to close naturally, blank lines between sections.`,
      features: `Extend: "..." → Extend (continue from end). Edit (V4): select time range → rewrite section. Download: MP3 (free) or MP4 (Pro). Persona: save vocal character. Remix: start new generation based on existing song.`,
    }
  },
  'webflow.com': {
    description: 'Visual web design tool and CMS for production websites.',
    docs: {
      designer: `Left sidebar: Add (+) elements, Navigator (element tree), Assets, Pages, CMS.\nRight sidebar: Style panel (CSS — layout, spacing, typography, borders, effects), Element settings (href, src, etc.).\nTop: Preview, Publish, breakpoints (D/T/L/P).`,
      styling: `Classes: type class name in Selector field → Enter. Classes are reusable.\nFlex: set display Flex → justify, align, gap. Grid: display Grid → columns/rows template.\nStates: hover/focus/active in dropdown next to selector. Transitions: Style → Transitions.`,
      cms: `Create collection: CMS tab → "+ New Collection" → define fields (plain text, rich text, image, number, date, option, reference, boolean).\nBind to design: select element → right panel CMS tab → connect field.\nCollection List: add element → bind to collection → style one item (repeats).`,
    }
  },
  'airtable.com': {
    description: 'Flexible database-spreadsheet hybrid for teams.',
    docs: {
      basics: `Structure: Workspace → Base → Table → Fields + Records.\nCreate base: "+ New Base". Add table: "+" tab. Add field: "+" at end of column headers.`,
      fields: `Field types: Single line, Long text, Number, Currency, Percent, Date, Single select, Multi-select, Checkbox, Attachment, Link to another record, Lookup, Rollup, Count, Formula, Created time, Last modified, Auto number, Button.`,
      automations: `Automations tab (top toolbar). Triggers: record matches condition, record created, record updated, scheduled time, form submitted, webhook.\nActions: Create record, Update record, Send email, Slack message, Run script, HTTP request, Find records.`,
    }
  },
};

function searchDocs(platform, query) {
  const kb = PLATFORM_KB[platform];
  if (!kb) return `No documentation found for platform "${platform}".`;
  const q = (query || '').toLowerCase();
  const results = [];
  for (const [section, content] of Object.entries(kb.docs)) {
    const words = q.split(/\s+/).filter(Boolean);
    const score = words.filter(w => content.toLowerCase().includes(w)).length;
    if (score > 0) results.push({ section, content, score });
  }
  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, 2);
  if (!top.length) return Object.values(kb.docs)[0];
  return top.map(r => r.content).join('\n\n---\n\n');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors();
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid JSON' }, 400); }
    try {
      if (path === '/call')  return await handleCall(body, env);
      if (path === '/list')  return handleList(body);
      if (path === '/auth')  return json({ status: 'auth_not_yet_implemented' });
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

async function handleCall({ platform, tool, input }, env) {
  if (!platform || !tool) return json({ error: 'platform and tool required' }, 400);
  const cacheKey = `${platform}:${tool}:${JSON.stringify(input || {})}`;
  if (env.MCP_CACHE) {
    const cached = await env.MCP_CACHE.get(cacheKey);
    if (cached) return json({ result: JSON.parse(cached), cached: true });
  }
  let result;
  if (tool === 'search_docs') {
    result = searchDocs(platform, input?.query || input?.q || '');
  } else {
    result = `Tool "${tool}" is not yet implemented for ${platform}.`;
  }
  if (env.MCP_CACHE && result) {
    await env.MCP_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 900 });
  }
  return json({ result });
}

function handleList({ platform } = {}) {
  if (!platform) return json({ error: 'platform required' }, 400);
  const kb = PLATFORM_KB[platform];
  const tools = [{ name: 'search_docs', description: `Search ${platform} documentation by keyword` }];
  return json({ platform, description: kb?.description || 'Unknown platform', tools });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  });
}
