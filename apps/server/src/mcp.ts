import { guideNextConversationDetailed, type GuideOptions } from '@alc/agent-core';
import {
  ANALYSIS_MODEL_AUTO_ID,
  GuidanceOutputSchema,
  GuidanceRequestSchema,
  type AnalysisModelId
} from '@alc/contracts';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

export type PublicInferenceRunner = <T>(operation: () => Promise<T>) => Promise<T>;
export type GuidanceOptionsResolver = (modelId: AnalysisModelId) => GuideOptions;

const runDirectly: PublicInferenceRunner = (operation) => operation();
const defaultGuideOptions: GuidanceOptionsResolver = (modelId) => {
  if (modelId !== ANALYSIS_MODEL_AUTO_ID) {
    throw new Error('Only automatic analysis model selection is configured.');
  }
  return {};
};

export function createGuidanceMcpHandler(
  resolveGuideOptions: GuidanceOptionsResolver = defaultGuideOptions,
  runPublicInference: PublicInferenceRunner = runDirectly
) {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: 'a-little-closer', version: '0.1.0' },
      { capabilities: { tools: { listChanged: false } } }
    );

    server.registerTool(
      'guide_next_conversation',
      {
        title: 'Guide the next conversation',
        description:
          'Turn a user-confirmed text conversation into respectful next-step options. Never sends messages or diagnoses people.',
        inputSchema: GuidanceRequestSchema,
        outputSchema: GuidanceOutputSchema
      },
      async (input) => {
        const { analysisModelId, ...validatedInput } = GuidanceRequestSchema.parse(input);
        const guideOptions = resolveGuideOptions(analysisModelId);
        const result = await runPublicInference(() =>
          guideNextConversationDetailed(validatedInput, guideOptions)
        );
        const output = GuidanceOutputSchema.parse(result.guidance);
        return {
          _meta: {
            'com.alittlecloser/provenance': result.provenance
          },
          structuredContent: { ...output },
          content: [{ type: 'text', text: JSON.stringify(output) }]
        };
      }
    );

    return server;
  });
}
