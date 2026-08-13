export class GuidanceJsonContentError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GuidanceJsonContentError';
  }
}

/** Parses one JSON object, allowing one optional outer ```json code fence. */
export function parseGuidanceJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (candidate.length === 0) {
    throw new GuidanceJsonContentError('Guidance JSON content is empty.');
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch (cause: unknown) {
    throw new GuidanceJsonContentError('Guidance JSON content is malformed.', cause);
  }
}
