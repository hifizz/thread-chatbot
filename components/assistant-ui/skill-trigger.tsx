"use client"

import { useMemo, type FC } from "react"
import { unstable_defaultDirectiveFormatter } from "@assistant-ui/react"
import { FileTextIcon, LanguagesIcon, SparklesIcon } from "lucide-react"
import { ComposerTriggerPopover } from "./composer-trigger-popover"
import { createDirectiveText } from "./directive-text"
import { SKILL_TRIGGER_CHAR } from "@/constants/skill"
import { createSkillTriggerAdapter } from "@/lib/skills/trigger-adapter"
import { useSkills } from "@/lib/skills/use-skills"

/** Maps skill frontmatter `icon` keys to icon components for the picker. */
const skillIconMap = {
  languages: LanguagesIcon,
  "file-text": FileTextIcon,
}

/**
 * Slash-command popover for the composer: lists skills from /api/skills and
 * inserts the selected one as a `:skill[label]{name=id}` directive.
 * Must be rendered inside `ComposerPrimitive.Unstable_TriggerPopoverRoot`.
 */
export const SkillTriggerPopover: FC = () => {
  const { skills, isLoading } = useSkills()
  const adapter = useMemo(() => createSkillTriggerAdapter(skills), [skills])

  return (
    <ComposerTriggerPopover
      char={SKILL_TRIGGER_CHAR}
      adapter={adapter}
      isLoading={isLoading}
      iconMap={skillIconMap}
      emptyItemsLabel="No matching skills"
      directive={{}}
    />
  )
}

/** `Text` part component that renders skill directives in user messages as chips. */
export const SkillDirectiveText = createDirectiveText(
  unstable_defaultDirectiveFormatter,
  { fallbackIcon: SparklesIcon }
)
