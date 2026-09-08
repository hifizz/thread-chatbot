import { notFound } from "next/navigation"
import { ContentHarness } from "./harness"
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <ContentHarness />
}
