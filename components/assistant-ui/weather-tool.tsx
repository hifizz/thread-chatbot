"use client"

import { useAssistantTool, type ToolCallMessagePartComponent } from "@assistant-ui/react"
import { CloudSunIcon, DropletIcon, LoaderIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type WeatherArgs = { location?: string }
type WeatherResult = {
  location: string
  temperatureF: number
  condition: string
  humidity: number
  asOf: string
}

const WeatherToolUI: ToolCallMessagePartComponent<WeatherArgs, WeatherResult> = ({
  args,
  result,
  status,
}) => {
  const isRunning = status.type === "running"

  return (
    <div
      data-slot="weather-tool"
      className="border-border/60 bg-muted/40 flex w-fit items-center gap-3 rounded-xl border px-3.5 py-2.5"
    >
      {isRunning ? (
        <LoaderIcon className="text-muted-foreground size-5 animate-spin" />
      ) : (
        <CloudSunIcon className="text-muted-foreground size-5" />
      )}
      <div className="flex flex-col">
        <span className="text-sm font-medium">
          {result?.location ?? args.location ?? "Weather"}
        </span>
        {result ? (
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>
              {result.temperatureF}°F, {result.condition}
            </span>
            <span className={cn("flex items-center gap-0.5")}>
              <DropletIcon className="size-3" />
              {result.humidity}%
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">Checking weather…</span>
        )}
      </div>
    </div>
  )
}

export function WeatherTool() {
  useAssistantTool({
    toolName: "getWeather",
    type: "backend",
    render: WeatherToolUI,
  })
  return null
}
