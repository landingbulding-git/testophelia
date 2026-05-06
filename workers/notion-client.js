/**
 * Notion REST helpers for Ophelia "Brain" tutorial plans.
 * Requires internal integration token + parent page shared with the integration.
 */

const NOTION_VERSION = '2022-06-28';

function notionHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
}

async function notionFetch(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: notionHeaders(token),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.code || res.statusText;
    throw new Error(`Notion API ${path}: ${res.status} ${msg}`);
  }
  return data;
}

export function notionPageWebUrl(pageId) {
  if (!pageId) return null;
  const raw = String(pageId).replace(/-/g, '');
  return `https://www.notion.so/${raw}`;
}

/**
 * Child page under parent with title + rich text blocks (context, URL, rules).
 */
const RT_MAX = 1900;

function textSegments(plain) {
  const s = String(plain || '');
  const parts = [];
  for (let i = 0; i < s.length; i += RT_MAX) {
    parts.push({ type: 'text', text: { content: s.slice(i, i + RT_MAX) } });
  }
  return parts.length ? parts : [{ type: 'text', text: { content: ' ' } }];
}

export async function createBrainPage(token, parentPageId, { title, userContext, youtubeUrl, videoSummary }) {
  const children = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: textSegments(`User context: ${userContext || 'Not specified'}`)
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { type: 'text', text: { content: `Source URL: ${youtubeUrl}` } }
        ]
      }
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: textSegments(
          'Workflow rule: only one row may be in "In Progress" at a time. ' +
            'Board view: open the linked database below → Layout → Board → Group by → Status ' +
            '(Notion Public API does not create grouped board views; set grouping once in the UI).'
        )
      }
    }
  ];

  if (videoSummary) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: textSegments(`Summary: ${videoSummary}`)
      }
    });
  }

  return notionFetch(token, '/pages', {
    method: 'POST',
    body: {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }]
        }
      },
      children
    }
  });
}

/**
 * Inline database on the Brain page: Name (title), Category (select), Status (select), Details (rich_text).
 */
export async function createPlanDatabase(token, brainPageId, { title }) {
  return notionFetch(token, '/databases', {
    method: 'POST',
    body: {
      parent: { page_id: brainPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties: {
        Name: { title: {} },
        Details: { rich_text: {} },
        Category: {
          select: {
            options: [
              { name: 'Learning', color: 'blue' },
              { name: 'Execution', color: 'orange' }
            ]
          }
        },
        Status: {
          select: {
            options: [
              { name: 'Not Started', color: 'gray' },
              { name: 'In Progress', color: 'yellow' },
              { name: 'Done', color: 'green' }
            ]
          }
        }
      }
    }
  });
}

function richTextFromPlain(text) {
  const t = String(text || '').slice(0, 1900);
  if (!t) return [];
  return [{ type: 'text', text: { content: t } }];
}

/**
 * @param {Array<{ title: string, details?: string, category: string, status?: string }>} rows
 */
export async function createDatabaseRows(token, databaseId, rows) {
  const created = [];
  for (const row of rows) {
    const statusName = row.status === 'In Progress' || row.status === 'Done' ? row.status : 'Not Started';
    const cat = row.category === 'Execution' ? 'Execution' : 'Learning';
    const page = await notionFetch(token, '/pages', {
      method: 'POST',
      body: {
        parent: { database_id: databaseId },
        properties: {
          Name: {
            title: richTextFromPlain(row.title)
          },
          Details: {
            rich_text: richTextFromPlain(row.details || '')
          },
          Category: { select: { name: cat } },
          Status: { select: { name: statusName } }
        }
      }
    });
    created.push(page);
  }
  return created;
}
