import { describeStep } from '../../shared/scenes';
import type { SceneStore } from '../apps/sceneStore';
import type { Tool } from './types';

/** Read-only: lists the user's saved scenes. Running one is done step by step with the normal, approved tools. */
export function createListScenesTool(scenes: SceneStore): Tool<Record<string, never>, unknown> {
  return {
    name: 'list_scenes',
    description:
      "List the user's saved scenes (named setups such as \"Study mode\"). To run a scene, do its steps in order with open_application, close_application, set_volume and set_brightness; each needs the user's approval. Report each step's real result and never claim the scene finished unless every step succeeded.",
    permissions: [],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return {
        scenes: scenes.list().map((scene) => ({
          name: scene.name,
          steps: scene.steps.map((step) => ({ ...step, text: describeStep(step) })),
        })),
      };
    },
  };
}
