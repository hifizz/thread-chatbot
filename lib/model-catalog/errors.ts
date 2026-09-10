export class ModelCatalogError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
