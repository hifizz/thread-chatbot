import { Suspense } from "react"
import { AuthForm } from "@/components/auth/auth-form"
import { googleAuthEnabled } from "@/lib/auth/social"

export default function SignUpPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-up" googleEnabled={googleAuthEnabled} />
    </Suspense>
  )
}
