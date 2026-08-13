import { useMode } from "@/context/mode"

export default function WorkbenchMode() {
  const mode = useMode()
  return (
    <main class="size-full flex items-center justify-center bg-background-base p-8" data-workbench-mode={mode.active()}>
      <section class="max-w-lg text-center space-y-3">
        <h1 class="text-24-medium capitalize">{mode.active()} mode</h1>
        <p class="text-14-regular text-text-weak">This Unifia surface is enabled in navigation and ready for its implementation card.</p>
      </section>
    </main>
  )
}
