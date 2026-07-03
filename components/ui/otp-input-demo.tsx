"use client"

import { OTPInput } from "@/components/ui/otp-input"
import { useState } from "react"

export default function OTPInputDemo() {
  const [value, setValue] = useState("")
  const isValid = value.length === 6 && value === "123456"
  const isError = value.length === 6 && !isValid

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <p className="text-sm text-muted-foreground">
          Enter code{" "}
          <span className="font-mono font-bold text-foreground">123456</span>
        </p>
        <OTPInput value={value} onChange={setValue} isError={isError} isValid={isValid} />
        <p className="text-xs text-muted-foreground h-4">
          {isValid ? "✓ Correct" : isError ? "✗ Incorrect code" : ""}
        </p>
      </div>
    </div>
  )
}
