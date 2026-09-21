export class MappingArtifactWorkbenchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "MappingArtifactWorkbenchError";
    this.code = code;
    this.status = status;
  }
}

export function asMappingArtifactError(error: unknown) {
  if (error instanceof MappingArtifactWorkbenchError) {
    return error;
  }
  return new MappingArtifactWorkbenchError(
    "internal_error",
    "The mapping artifact operation failed. Please try again or contact an administrator.",
    500,
  );
}
