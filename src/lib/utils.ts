import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function throttle<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let lastTime = 0
  let timeout: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null

  const invoke = () => {
    if (lastArgs) {
      fn(...lastArgs)
      lastArgs = null
      lastTime = Date.now()
    }
    timeout = null
  }

  return (...args: Parameters<T>) => {
    const now = Date.now()
    const remaining = wait - (now - lastTime)
    lastArgs = args

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      invoke()
    } else if (!timeout) {
      timeout = setTimeout(invoke, remaining)
    }
  }
}
