"use client"

import { useAssistantTool, type ToolCallMessagePartComponent } from "@assistant-ui/react"
import { ChartColumnIcon } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type CompareTableArgs = {
  title?: string
  unit?: string
  columns?: string[]
  series?: { name: string; values: number[] }[]
}
type CompareTableResult = {
  title: string
  unit?: string
  columns: string[]
  series: { name: string; values: number[] }[]
}

const CompareTableToolUI: ToolCallMessagePartComponent<CompareTableArgs, CompareTableResult> = ({
  args,
  result,
}) => {
  const title = result?.title ?? args.title ?? "Comparison"
  const unit = result?.unit ?? args.unit
  const columns = result?.columns ?? args.columns ?? []
  const series = result?.series ?? args.series ?? []

  return (
    <Card data-slot="compare-table-tool" className="w-full max-w-xl gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ChartColumnIcon className="size-4" />
          {title}
          {unit && <span className="text-muted-foreground font-normal">({unit})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {columns.length === 0 ? (
          <p className="text-muted-foreground text-sm">Building table…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  {columns.map((_, index) => (
                    <TableCell key={index}>{row.values[index] ?? "—"}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function CompareTableTool() {
  useAssistantTool({
    toolName: "compareTable",
    type: "backend",
    display: "standalone",
    render: CompareTableToolUI,
  })
  return null
}
