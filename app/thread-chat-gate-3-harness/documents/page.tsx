import { notFound } from "next/navigation"
import { DocumentsHarness } from "./harness"
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <DocumentsHarness />
}
