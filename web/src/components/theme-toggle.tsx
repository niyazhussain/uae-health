import { MoonIcon, SunIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { applyTheme, getAppliedTheme, type Theme } from "@/lib/theme"

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getAppliedTheme)
  const nextTheme = theme === "light" ? "dark" : "light"
  const label = `Use ${nextTheme} theme`

  function toggleTheme() {
    applyTheme(nextTheme)
    setTheme(nextTheme)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          onClick={toggleTheme}
          size="icon"
          variant="outline"
        >
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
