type ExpandedPromptFileReferences = {
  message: string;
};

/**
 * Preserve prompt file references exactly as typed.
 *
 * Pi's interactive CLI treats `@path` as an editable path reference: the model can
 * use its normal file tools, including `read`, when it needs the referenced file.
 * GUI composer drops also insert `@path` text, so the backend must not silently
 * inline file contents or convert image references into RPC attachments.
 */
export async function expandPromptFileReferences(message: string, _cwd: string): Promise<ExpandedPromptFileReferences> {
  return { message };
}
