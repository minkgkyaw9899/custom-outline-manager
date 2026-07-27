import { MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"

export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() =>
        setTheme(
          theme === "dark"
            ? "light"
            : theme === "light"
              ? "dark"
              : window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "light"
                : "dark",
        )
      }
    >
      <SunIcon className="size-4 scale-100 dark:scale-0" />
      <MoonIcon className="absolute size-4 scale-0 dark:scale-100" />
    </Button>
  )
}
