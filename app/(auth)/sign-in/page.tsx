import { Suspense } from "react"
import { AuthForm } from "@/components/auth/auth-form"
import { googleAuthEnabled } from "@/lib/auth/social"

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" googleEnabled={googleAuthEnabled} />
    </Suspense>
  )
}
