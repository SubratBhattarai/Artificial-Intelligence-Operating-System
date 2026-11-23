import type { ToolSchema } from '../tools/types';

/**
 * Sending every tool description on every turn makes the model read thousands of extra words before it
 * answers. Each turn only gets the tools that plausibly match what was asked, plus a small always-on core.
 * This only decides what the model is *shown*: permissions and approvals are still enforced in code.
 */
const CORE = new Set([
  'search_memory',
  'search_files',
  'read_document',
  'list_tasks',
  'list_events',
  'calculate',
  'prepare_briefing',
]);

const GROUPS: Array<{ words: RegExp; tools: string[] }> = [
  {
    words: /\b(task|todo|to-do|remind|reminder|deadline|due|done|finish)/i,
    tools: ['create_task', 'complete_task'],
  },
  { words: /\b(calendar|event|meeting|schedule|appointment|class)/i, tools: ['create_event'] },
  { words: /\b(note|jot|write down|idea)/i, tools: ['create_note'] },
  { words: /\b(mail|email|inbox|message)/i, tools: ['list_mail'] },
  { words: /\b(remember|memory|forget|save that)/i, tools: ['propose_memory'] },
  {
    words:
      /\b(file|folder|document|pdf|docx|spreadsheet|excel|slides|powerpoint|move|rename|create|edit|append|copy)/i,
    tools: ['create_file', 'move_file', 'edit_file', 'append_to_file', 'compare_documents'],
  },
  { words: /\b(compare|difference|differ|versus|vs)\b/i, tools: ['compare_documents'] },
  {
    words:
      /\b(open|close|launch|quit|start|app|application|notepad|paint|calculator|brave|chrome|edge|firefox|browser|settings|photos|clock|snipping|task manager|explorer|camera)/i,
    tools: ['list_apps', 'open_application', 'close_application', 'open_ai_os_app'],
  },
  {
    words: /\b(volume|louder|quieter|mute|unmute|sound|brightness|brighter|dimmer|dim)/i,
    tools: ['set_volume', 'set_brightness'],
  },
  {
    words: /\b(terminal|command|powershell|cmd|shell|run|script|install|git|npm)/i,
    tools: ['run_command'],
  },
  {
    words:
      /\b(build|develop|prototype)\b.*\b(app|website|site|page|game|script|program|tool|software)\b|\b(lab|project|preview|npm|pytest|unit test)/i,
    tools: [
      'lab_list_projects',
      'lab_create_project',
      'lab_run',
      'lab_preview',
      'create_file',
      'edit_file',
    ],
  },
  {
    words:
      /\b(what am i (doing|working|looking)|which app|active (app|window)|battery|charging|wifi|wi-fi|network|online|offline|clipboard|copied|surroundings|around me|camera|room|see me|my desk|scan|look around|what do you see|focus on)/i,
    tools: ['get_active_window', 'get_system_state', 'read_clipboard', 'describe_surroundings'],
  },
  {
    words: /\b(screen|screenshot|what'?s on|looking at|display|see this)/i,
    tools: ['read_screen'],
  },
  {
    words:
      /\b(search|google|web|online|internet|website|site|page|url|http|news|weather|look up|browse)/i,
    tools: ['web_search', 'fetch_page', 'open_in_browser'],
  },
  {
    words: /\b(agent|research|monitor|watch|track|report|background|investigate)/i,
    tools: ['start_agent', 'create_monitor', 'save_report'],
  },
  {
    words: /\b(scene|mode|routine|setup|study|workspace|wind down|get ready)/i,
    tools: ['list_scenes', 'open_application', 'close_application', 'set_volume', 'set_brightness'],
  },
  { words: /\b(cpu|ram|memory usage|disk|performance|system|battery)/i, tools: ['system_metrics'] },
];

/** Everyday small talk and general questions need no tools; skipping them makes the first word come sooner. */
const PERSONAL_WORDS =
  /\b(my|mine|remember|recall|earlier|before|file|folder|document|note|task|todo|today|tomorrow|tonight|calendar|schedule|find|search|briefing|calculate|compute|total|sum|\d)/i;

export function selectTools(all: ToolSchema[], userText: string): ToolSchema[] {
  const wanted = new Set<string>();
  let matched = false;
  for (const group of GROUPS) {
    if (group.words.test(userText)) {
      group.tools.forEach((name) => wanted.add(name));
      matched = true;
    }
  }
  if (matched || PERSONAL_WORDS.test(userText)) CORE.forEach((name) => wanted.add(name));
  return all.filter((tool) => wanted.has(tool.function.name));
}
