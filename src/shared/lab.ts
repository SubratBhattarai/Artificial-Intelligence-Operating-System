/** Engineering Lab contracts. Local only: projects live in a folder, previews bind to 127.0.0.1. */

export const LAB_TEMPLATES = ['static-site', 'node-script', 'python-script'] as const;
export type LabTemplate = (typeof LAB_TEMPLATES)[number];

/** The only commands the Lab will ever run. Fixed text, so the model cannot inject anything. */
export const LAB_COMMANDS = {
  'npm-install': 'npm install --no-audit --no-fund',
  'npm-test': 'npm test --silent',
  'npm-build': 'npm run build --if-present',
  'node-main': 'node main.js',
  'python-main': 'python main.py',
  'python-test': 'python -m pytest -q',
} as const;
export type LabCommandId = keyof typeof LAB_COMMANDS;
export const LAB_COMMAND_IDS = Object.keys(LAB_COMMANDS) as LabCommandId[];

export interface LabProject {
  name: string;
  template: string;
  hasPackageJson: boolean;
  previewPort: number | null;
}

export interface LabRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

/** Project names become folder names, so keep them to a boring safe alphabet. */
export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(name);
}
