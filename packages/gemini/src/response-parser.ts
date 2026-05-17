export function parseAgentResponse<T = unknown>(responseContent: string): T {
  let cleaned = responseContent.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "");
    cleaned = cleaned.replace(/\n```$/, "");
    cleaned = cleaned.trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    const startIndex = cleaned.indexOf("{");
    const endIndex = cleaned.lastIndexOf("}");
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      try {
        const extracted = cleaned.slice(startIndex, endIndex + 1);
        return JSON.parse(extracted) as T;
      } catch (innerError) {
        throw new Error(
          `Failed to parse agent JSON response. Extracted snippet failed. Error: ${
            (innerError as Error).message
          }`,
        );
      }
    }
    throw new Error(
      `Failed to parse agent JSON response. Could not isolate JSON. Error: ${(error as Error).message}`,
    );
  }
}
