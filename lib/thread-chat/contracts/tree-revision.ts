import { z } from "zod"

/** 树写命令使用的非负 CAS 修订号。 */
export const treeRevisionSchema = z.number().int().nonnegative()

export type TreeRevision = z.infer<typeof treeRevisionSchema>
